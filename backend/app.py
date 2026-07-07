from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
from datetime import datetime, timedelta, timezone
from functools import wraps
from typing import Any
from urllib.parse import urlencode

import jwt
import requests
from dotenv import load_dotenv
from flask import Flask, g, jsonify, request
from flask_cors import CORS
from supabase import Client, create_client

load_dotenv()


def env(name: str, default: str | None = None, required: bool = False) -> str:
    value = os.getenv(name, default)
    if required and not value:
        raise RuntimeError(f"Variável obrigatória ausente: {name}")
    return value or ""


SUPABASE_URL = env("SUPABASE_URL", required=True)
SUPABASE_ANON_KEY = env("SUPABASE_ANON_KEY", required=True)
SUPABASE_SERVICE_ROLE_KEY = env("SUPABASE_SERVICE_ROLE_KEY", required=True)
FRONTEND_URL = env("FRONTEND_URL", "http://localhost:5173")
PUBLIC_BACKEND_URL = env("PUBLIC_BACKEND_URL", "http://localhost:5000").rstrip("/")
PUSHINPAY_TOKEN = env("PUSHINPAY_TOKEN")
PUSHINPAY_CASHIN_URL = env(
    "PUSHINPAY_CASHIN_URL",
    "https://api.pushinpay.com.br/api/pix/cashIn",
)
PUSHINPAY_TRANSACTION_URL = env(
    "PUSHINPAY_TRANSACTION_URL",
    "https://api.pushinpay.com.br/api/transaction/{id}",
)
PUSHINPAY_STATUS_SYNC_SECONDS = max(
    int(env("PUSHINPAY_STATUS_SYNC_SECONDS", "60")),
    60,
)
PUSHINPAY_WEBHOOK_TOKEN = env("PUSHINPAY_WEBHOOK_TOKEN", required=True)
APP_VERSION = "2026-07-07-pushinpay-sync-v3.1"
STREAM_SIGNING_SECRET = env("STREAM_SIGNING_SECRET", required=True)
LICENSED_STREAM_BASE_URL = env("LICENSED_STREAM_BASE_URL", "https://stream.example.com/watch").rstrip("/")
TRIAL_DURATION_MINUTES = int(env("TRIAL_DURATION_MINUTES", "60"))
ACCESS_TOKEN_TTL_MINUTES = int(env("ACCESS_TOKEN_TTL_MINUTES", "5"))
PAYMENT_MOCK = env("PAYMENT_MOCK", "false").lower() == "true"

# Integração do gerador de teste externo (Painel Slim ou outro provedor autorizado).
TRIAL_PROVIDER_URL = env("TRIAL_PROVIDER_URL")
TRIAL_PROVIDER_METHOD = env("TRIAL_PROVIDER_METHOD", "POST").upper()
TRIAL_PROVIDER_BODY_MODE = env("TRIAL_PROVIDER_BODY_MODE", "auto").lower()
TRIAL_PROVIDER_HEADERS_JSON = env("TRIAL_PROVIDER_HEADERS_JSON", "{}")
TRIAL_PROVIDER_TIMEOUT_SECONDS = int(env("TRIAL_PROVIDER_TIMEOUT_SECONDS", "30"))
TRIAL_PROVIDER_VERIFY_SSL = env("TRIAL_PROVIDER_VERIFY_SSL", "true").lower() == "true"
TRIAL_PROVIDER_MOCK = env("TRIAL_PROVIDER_MOCK", "false").lower() == "true"
TRIAL_REQUEST_COOLDOWN_HOURS = int(env("TRIAL_REQUEST_COOLDOWN_HOURS", "720"))
TRIAL_IP_COOLDOWN_HOURS = int(env("TRIAL_IP_COOLDOWN_HOURS", "6"))

app = Flask(__name__)
CORS(
    app,
    resources={r"/*": {"origins": [FRONTEND_URL, "http://localhost:5173"]}},
    supports_credentials=False,
)

supabase: Client = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat()


def json_error(message: str, status: int = 400):
    return jsonify({"error": message}), status


def first(data: Any) -> dict | None:
    if isinstance(data, list):
        return data[0] if data else None
    if isinstance(data, dict):
        return data
    return None


def db_one(query) -> dict | None:
    result = query.limit(1).execute()
    return first(result.data)


def verify_supabase_user(access_token: str) -> dict:
    response = requests.get(
        f"{SUPABASE_URL}/auth/v1/user",
        headers={
            "apikey": SUPABASE_ANON_KEY,
            "Authorization": f"Bearer {access_token}",
        },
        timeout=12,
    )
    if response.status_code != 200:
        raise PermissionError("Sessão inválida ou expirada.")
    return response.json()


def require_user(fn):
    @wraps(fn)
    def wrapper(*args, **kwargs):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            return json_error("Faça login para continuar.", 401)
        try:
            user = verify_supabase_user(auth.split(" ", 1)[1].strip())
        except (PermissionError, requests.RequestException):
            return json_error("Sessão inválida ou expirada.", 401)
        g.user = user
        return fn(*args, **kwargs)

    return wrapper


def get_profile(user_id: str) -> dict | None:
    return db_one(supabase.table("profiles").select("*").eq("id", user_id))


def require_admin(fn):
    @wraps(fn)
    @require_user
    def wrapper(*args, **kwargs):
        profile = get_profile(g.user["id"])
        if not profile or profile.get("role") != "admin":
            return json_error("Acesso restrito à administração.", 403)
        g.profile = profile
        return fn(*args, **kwargs)

    return wrapper


def clean_text(value: Any, max_len: int = 300) -> str:
    return str(value or "").strip()[:max_len]


def token_hash(raw: str) -> str:
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def issue_access_token(user_id: str, subscription_id: str | None, kind: str) -> str:
    raw = secrets.token_urlsafe(36)
    supabase.table("access_tokens").update({"revoked_at": iso(utcnow())}).eq("user_id", user_id).is_(
        "revoked_at", "null"
    ).execute()
    supabase.table("access_tokens").insert(
        {
            "user_id": user_id,
            "subscription_id": subscription_id,
            "token_hash": token_hash(raw),
            "kind": kind,
            "created_at": iso(utcnow()),
        }
    ).execute()
    return raw


def current_subscription(user_id: str) -> dict | None:
    now = iso(utcnow())
    return db_one(
        supabase.table("subscriptions")
        .select("*, plans(name, slug, duration_days)")
        .eq("user_id", user_id)
        .eq("status", "active")
        .gt("ends_at", now)
        .order("ends_at", desc=True)
    )


def activate_subscription(payment: dict) -> dict:
    """Ativa ou renova uma assinatura sem duplicar o mesmo pagamento."""
    user_id = payment["user_id"]
    payment_id = payment["id"]

    already_linked = db_one(
        supabase.table("subscriptions")
        .select("*, plans(name, slug, duration_days)")
        .eq("payment_id", payment_id)
    )
    if already_linked:
        return already_linked

    plan = db_one(
        supabase.table("plans")
        .select("*")
        .eq("id", payment["plan_id"])
    )
    if not plan:
        raise RuntimeError("Plano não encontrado para ativação.")

    now = utcnow()
    current = current_subscription(user_id)
    start = now
    if current:
        try:
            current_end = datetime.fromisoformat(
                current["ends_at"].replace("Z", "+00:00")
            )
            start = max(now, current_end)
        except Exception:
            start = now

    end = start + timedelta(days=int(plan["duration_days"]))
    payload = {
        "user_id": user_id,
        "plan_id": plan["id"],
        "payment_id": payment_id,
        "status": "active",
        "starts_at": iso(start),
        "ends_at": iso(end),
        "updated_at": iso(now),
        "is_trial": False,
    }

    existing_any = db_one(
        supabase.table("subscriptions")
        .select("*")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
    )

    if existing_any:
        if existing_any.get("payment_id") == payment_id:
            return existing_any
        result = (
            supabase.table("subscriptions")
            .update(payload)
            .eq("id", existing_any["id"])
            .execute()
        )
    else:
        result = supabase.table("subscriptions").insert(payload).execute()

    subscription = first(result.data)
    if not subscription:
        subscription = db_one(
            supabase.table("subscriptions")
            .select("*, plans(name, slug, duration_days)")
            .eq("payment_id", payment_id)
        )
    return subscription or payload


def deep_get(payload: Any, keys: tuple[str, ...]) -> Any:
    if isinstance(payload, dict):
        for key in keys:
            if key in payload and payload[key] not in (None, ""):
                return payload[key]
        for value in payload.values():
            found = deep_get(value, keys)
            if found not in (None, ""):
                return found
    if isinstance(payload, list):
        for item in payload:
            found = deep_get(item, keys)
            if found not in (None, ""):
                return found
    return None


def normalize_pushinpay_response(payload: dict) -> dict:
    provider_status = clean_text(deep_get(payload, ("status", "payment_status", "paymentStatus")), 50).lower()
    status_map = {
        "pending": "pending", "created": "pending", "waiting": "pending",
        "processing": "processing", "paid": "paid", "approved": "paid",
        "completed": "paid", "confirmed": "paid", "failed": "failed",
        "cancelled": "cancelled", "canceled": "cancelled", "expired": "expired",
    }
    return {
        "provider_transaction_id": clean_text(
            deep_get(payload, ("transaction_id", "transactionId", "pix_id", "pixId", "id")), 160
        ),
        "status": status_map.get(provider_status, "pending"),
        "qr_code": deep_get(payload, ("qr_code_base64", "qrCodeBase64", "qr_code_image", "qrCodeImage", "base64")),
        "copy_paste": deep_get(
            payload,
            (
                "qr_code",
                "qrCode",
                "qr_code_text",
                "qrCodeText",
                "copy_paste",
                "copyPaste",
                "pix_copy_paste",
                "pixCopiaECola",
                "emv",
            ),
        ),
        "expires_at": deep_get(payload, ("expires_at", "expiration", "expiresAt")),
        "raw": payload,
    }


def create_pushinpay_charge(payment_id: str, value_cents: int) -> dict:
    webhook_query = urlencode({"token": PUSHINPAY_WEBHOOK_TOKEN, "payment_id": payment_id})
    webhook_url = f"{PUBLIC_BACKEND_URL}/webhooks/pushinpay?{webhook_query}"

    if PAYMENT_MOCK:
        return {
            "provider_transaction_id": f"mock_{secrets.token_hex(8)}",
            "status": "pending",
            "qr_code": None,
            "copy_paste": f"00020126580014BR.GOV.BCB.PIX0136mock-{payment_id}",
            "expires_at": iso(utcnow() + timedelta(minutes=30)),
            "raw": {"mock": True, "webhook_url": webhook_url},
        }

    if not PUSHINPAY_TOKEN:
        raise RuntimeError("PUSHINPAY_TOKEN não configurado.")

    response = requests.post(
        PUSHINPAY_CASHIN_URL,
        headers={
            "Authorization": f"Bearer {PUSHINPAY_TOKEN}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        json={"value": value_cents, "webhook_url": webhook_url, "split_rules": []},
        timeout=25,
    )
    try:
        payload = response.json()
    except ValueError:
        payload = {"message": response.text[:1000]}
    if response.status_code >= 400:
        raise RuntimeError(clean_text(payload.get("message") or payload.get("error") or "Falha na PushinPay", 500))
    return normalize_pushinpay_response(payload)


PAID_PROVIDER_STATUSES = {
    "paid",
    "approved",
    "completed",
    "confirmed",
    "pix_paid",
    "payment.paid",
}

PROVIDER_STATUS_MAP = {
    "created": "pending",
    "pending": "pending",
    "waiting": "pending",
    "processing": "processing",
    "failed": "failed",
    "cancelled": "cancelled",
    "canceled": "cancelled",
    "expired": "expired",
    "refunded": "refunded",
}


def parse_iso_datetime(value: Any) -> datetime | None:
    text = clean_text(value, 100)
    if not text:
        return None
    try:
        return datetime.fromisoformat(
            text.replace("Z", "+00:00")
        ).astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def should_sync_payment(payment: dict) -> bool:
    if PAYMENT_MOCK:
        return False
    if payment.get("status") not in {
        "pending",
        "processing",
        "created",
    }:
        return False
    if not payment.get("provider_transaction_id"):
        return False

    last_checked = parse_iso_datetime(payment.get("last_checked_at"))
    if not last_checked:
        return True

    elapsed = (utcnow() - last_checked).total_seconds()
    return elapsed >= PUSHINPAY_STATUS_SYNC_SECONDS


def fetch_pushinpay_transaction(provider_transaction_id: str) -> dict:
    if not PUSHINPAY_TOKEN:
        raise RuntimeError("PUSHINPAY_TOKEN não configurado.")

    url = PUSHINPAY_TRANSACTION_URL.format(
        id=provider_transaction_id
    )
    response = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {PUSHINPAY_TOKEN}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        timeout=25,
    )

    try:
        payload = response.json()
    except ValueError:
        payload = {"message": response.text[:1000]}

    if response.status_code == 404 or payload == []:
        raise RuntimeError("Transação não encontrada na PushinPay.")

    if response.status_code >= 400:
        message = None
        if isinstance(payload, dict):
            message = payload.get("message") or payload.get("error")
        raise RuntimeError(
            clean_text(
                message
                or f"PushinPay retornou HTTP {response.status_code}.",
                500,
            )
        )

    if isinstance(payload, list):
        payload = payload[0] if payload else {}

    if not isinstance(payload, dict) or not payload:
        raise RuntimeError(
            "A PushinPay retornou uma resposta vazia ou inválida."
        )

    return payload


def provider_status(payload: dict) -> str:
    return clean_text(
        deep_get(
            payload,
            ("status", "payment_status", "paymentStatus", "type"),
        ),
        80,
    ).lower()


def validate_provider_transaction(
    payment: dict,
    payload: dict,
) -> None:
    expected_provider_id = clean_text(
        payment.get("provider_transaction_id"),
        160,
    )
    received_provider_id = clean_text(
        deep_get(
            payload,
            (
                "transaction_id",
                "transactionId",
                "pix_id",
                "pixId",
                "id",
            ),
        ),
        160,
    )

    if (
        expected_provider_id
        and received_provider_id
        and expected_provider_id != received_provider_id
    ):
        raise ValueError(
            "Identificador da transação não confere."
        )

    amount_raw = deep_get(
        payload,
        ("value", "amount", "amount_cents", "value_cents"),
    )
    if amount_raw not in (None, ""):
        try:
            raw_number = float(amount_raw)
            expected = int(payment["amount_cents"])
            candidates = {
                int(round(raw_number)),
                int(round(raw_number * 100)),
            }
        except (TypeError, ValueError) as exc:
            raise ValueError(
                "Valor inválido retornado pela PushinPay."
            ) from exc

        if expected not in candidates:
            raise ValueError(
                "Valor da transação não confere."
            )


def apply_pushinpay_status(
    payment: dict,
    payload: dict,
    *,
    received_webhook: dict | None = None,
) -> tuple[dict, dict | None]:
    validate_provider_transaction(payment, payload)

    raw_status = provider_status(payload)
    normalized_status = (
        "paid"
        if raw_status in PAID_PROVIDER_STATUSES
        else PROVIDER_STATUS_MAP.get(
            raw_status,
            payment["status"],
        )
    )

    now_text = iso(utcnow())
    update: dict[str, Any] = {
        "last_checked_at": now_text,
        "last_check_response": payload,
        "status": normalized_status,
    }

    if received_webhook is not None:
        update["webhook_payload"] = {
            "received": received_webhook,
            "resolved": payload,
        }

    if normalized_status == "paid":
        update["paid_at"] = payment.get("paid_at") or now_text

    result = (
        supabase.table("payments")
        .update(update)
        .eq("id", payment["id"])
        .execute()
    )
    updated_payment = first(result.data) or {
        **payment,
        **update,
    }

    subscription = None
    if normalized_status == "paid":
        subscription = activate_subscription(updated_payment)
        audit_event(
            updated_payment["user_id"],
            "subscription_activated",
            {"payment_id": updated_payment["id"]},
        )

    return updated_payment, subscription


def sync_payment_from_pushinpay(
    payment: dict,
    *,
    force: bool = False,
    received_webhook: dict | None = None,
) -> tuple[dict, dict | None, bool]:
    if PAYMENT_MOCK:
        return payment, None, False

    if payment.get("status") == "paid":
        subscription = activate_subscription(payment)
        return payment, subscription, False

    if not payment.get("provider_transaction_id"):
        raise RuntimeError(
            "Pagamento sem identificador da transação na PushinPay."
        )

    if not force and not should_sync_payment(payment):
        return payment, None, False

    try:
        (
            supabase.table("payments")
            .update({"last_checked_at": iso(utcnow())})
            .eq("id", payment["id"])
            .execute()
        )
    except Exception:
        app.logger.exception(
            "Não foi possível registrar last_checked_at."
        )

    payload = fetch_pushinpay_transaction(
        payment["provider_transaction_id"]
    )
    updated_payment, subscription = apply_pushinpay_status(
        payment,
        payload,
        received_webhook=received_webhook,
    )
    return updated_payment, subscription, True


def audit_event(user_id: str | None, event_type: str, metadata: dict | None = None):
    try:
        supabase.table("usage_events").insert(
            {
                "user_id": user_id,
                "event_type": event_type,
                "metadata": metadata or {},
                "created_at": iso(utcnow()),
            }
        ).execute()
    except Exception:
        pass


def normalize_phone(value: Any) -> str:
    digits = re.sub(r"\D+", "", str(value or ""))
    if digits.startswith("0"):
        digits = digits.lstrip("0")
    if len(digits) in {10, 11}:
        digits = "55" + digits
    return digits[:15]


def mask_phone(value: str) -> str:
    digits = normalize_phone(value)
    if len(digits) < 8:
        return "***"
    return f"+{digits[:2]} ({digits[2:4]}) *****-{digits[-4:]}"


def parse_provider_headers() -> dict[str, str]:
    try:
        raw = json.loads(TRIAL_PROVIDER_HEADERS_JSON or "{}")
        if not isinstance(raw, dict):
            return {}
        return {clean_text(k, 120): clean_text(v, 600) for k, v in raw.items() if k and v}
    except Exception:
        return {}


def response_to_payload(response: requests.Response) -> tuple[Any, str]:
    text = response.text[:20000]
    try:
        payload = response.json()
        return payload, text
    except ValueError:
        return text, text


def recursive_value(payload: Any, names: tuple[str, ...]) -> Any:
    wanted = {name.lower() for name in names}
    if isinstance(payload, dict):
        for key, value in payload.items():
            if str(key).lower() in wanted and value not in (None, ""):
                return value
        for value in payload.values():
            found = recursive_value(value, names)
            if found not in (None, ""):
                return found
    elif isinstance(payload, list):
        for value in payload:
            found = recursive_value(value, names)
            if found not in (None, ""):
                return found
    return None


def regex_field(text: str, labels: tuple[str, ...]) -> str | None:
    joined = "|".join(re.escape(label) for label in labels)
    patterns = [
        rf"(?im)^\s*(?:{joined})\s*[:=\-]\s*([^\r\n]+)",
        rf"(?i)(?:{joined})\s*[:=\-]\s*([^|;,\r\n]+)",
    ]
    for pattern in patterns:
        match = re.search(pattern, text)
        if match:
            return clean_text(match.group(1), 1000)
    return None


def normalize_trial_result(payload: Any, raw_text: str) -> dict:
    text = raw_text or (json.dumps(payload, ensure_ascii=False) if isinstance(payload, (dict, list)) else str(payload or ""))
    username = recursive_value(payload, ("username", "user", "usuario", "login")) if isinstance(payload, (dict, list)) else None
    password = recursive_value(payload, ("password", "pass", "senha")) if isinstance(payload, (dict, list)) else None
    server = recursive_value(payload, ("server", "host", "dns", "servidor", "base_url", "baseUrl")) if isinstance(payload, (dict, list)) else None
    playlist = recursive_value(payload, ("m3u", "m3u_url", "m3uUrl", "playlist", "playlist_url", "url")) if isinstance(payload, (dict, list)) else None
    expires_at = recursive_value(payload, ("expires_at", "expiresAt", "expiration", "valid_until", "validade", "expira")) if isinstance(payload, (dict, list)) else None
    message = recursive_value(payload, ("message", "mensagem", "response", "resposta", "data")) if isinstance(payload, dict) else None

    username = clean_text(username or regex_field(text, ("usuário", "usuario", "user", "login")), 500) or None
    password = clean_text(password or regex_field(text, ("senha", "password", "pass")), 500) or None
    server = clean_text(server or regex_field(text, ("servidor", "server", "host", "dns")), 1000) or None
    playlist = clean_text(playlist or regex_field(text, ("url m3u", "m3u", "playlist", "lista", "link")), 2000) or None
    expires_at = clean_text(expires_at or regex_field(text, ("validade", "expira", "expiração", "expiration", "expires")), 500) or None
    if isinstance(message, (dict, list)):
        message = json.dumps(message, ensure_ascii=False)
    message = clean_text(message or text, 12000)

    return {
        "username": username,
        "password": password,
        "server": server,
        "playlist_url": playlist,
        "expires_at": expires_at,
        "message": message,
    }


def call_trial_provider(customer: dict) -> tuple[dict, dict]:
    if TRIAL_PROVIDER_MOCK:
        payload = {
            "message": "Teste de demonstração criado com sucesso.",
            "username": "demo" + secrets.token_hex(3),
            "password": secrets.token_urlsafe(6),
            "server": "http://demo.exemplo.com",
            "expires_at": iso(utcnow() + timedelta(minutes=60)),
        }
        return normalize_trial_result(payload, json.dumps(payload, ensure_ascii=False)), payload

    if not TRIAL_PROVIDER_URL:
        raise RuntimeError("TRIAL_PROVIDER_URL não configurada no backend.")

    headers = {"Accept": "application/json, text/plain, */*", "User-Agent": "CineVizzo-Trial-Gateway/1.0"}
    headers.update(parse_provider_headers())
    common_payload = {
        "name": customer.get("name"),
        "nome": customer.get("name"),
        "phone": customer.get("phone"),
        "telefone": customer.get("phone"),
        "whatsapp": customer.get("phone"),
        "email": customer.get("email"),
        "device": customer.get("device"),
        "dispositivo": customer.get("device"),
    }

    attempts: list[tuple[str, dict]]
    if TRIAL_PROVIDER_BODY_MODE == "empty":
        attempts = [("empty", {})]
    elif TRIAL_PROVIDER_BODY_MODE == "json":
        attempts = [("json", {"json": common_payload})]
    elif TRIAL_PROVIDER_BODY_MODE == "form":
        attempts = [("form", {"data": common_payload})]
    else:
        # O link usado pelo chatbot costuma aceitar POST sem corpo. Se o provedor
        # exigir dados do contato, a segunda tentativa usa um JSON com aliases comuns.
        attempts = [("empty", {}), ("json", {"json": common_payload})]

    last_error = "O provedor não respondeu."
    for mode, kwargs in attempts:
        try:
            response = requests.request(
                TRIAL_PROVIDER_METHOD,
                TRIAL_PROVIDER_URL,
                headers=headers,
                timeout=TRIAL_PROVIDER_TIMEOUT_SECONDS,
                verify=TRIAL_PROVIDER_VERIFY_SSL,
                **kwargs,
            )
        except requests.RequestException as exc:
            last_error = f"Falha ao conectar ao provedor: {exc}"
            continue
        payload, raw_text = response_to_payload(response)
        if 200 <= response.status_code < 300:
            normalized = normalize_trial_result(payload, raw_text)
            return normalized, {
                "status_code": response.status_code,
                "body_mode": mode,
                "payload": payload if isinstance(payload, (dict, list)) else raw_text[:12000],
            }
        error_message = None
        if isinstance(payload, dict):
            error_message = payload.get("message") or payload.get("error")
        last_error = clean_text(error_message or raw_text or f"HTTP {response.status_code}", 1000)
        if response.status_code not in {400, 415, 422}:
            break
    raise RuntimeError(last_error)


@app.get("/")
def root():
    return jsonify({"service": "CineVizzo API", "status": "online", "legal_use": "licensed-content-only"})


@app.get("/health")
def health():
    return jsonify(
        {
            "ok": True,
            "time": iso(utcnow()),
            "version": APP_VERSION,
        }
    )


@app.get("/plans")
def list_plans():
    result = supabase.table("plans").select("id,name,slug,description,price_cents,duration_days,features").eq(
        "active", True
    ).order("price_cents").execute()
    return jsonify({"plans": result.data or []})


@app.get("/me")
@require_user
def me():
    user_id = g.user["id"]
    return jsonify(
        {
            "user": {"id": user_id, "email": g.user.get("email")},
            "profile": get_profile(user_id),
            "subscription": current_subscription(user_id),
        }
    )


@app.post("/public/trials")
def create_public_provider_trial():
    body = request.get_json(silent=True) or {}
    name = clean_text(body.get("name"), 120)
    phone = normalize_phone(body.get("phone"))
    email = clean_text(body.get("email"), 180).lower()
    device = clean_text(body.get("device"), 80)
    accepted = bool(body.get("accepted_terms"))
    honeypot = clean_text(body.get("company"), 100)

    if honeypot:
        return json_error("Solicitação inválida.", 400)
    if len(name) < 2:
        return json_error("Informe seu nome.")
    if len(phone) < 12:
        return json_error("Informe um WhatsApp válido com DDD.")
    if device not in {"android_tv", "fire_tv", "tv_box", "smartphone", "computador", "outro"}:
        return json_error("Selecione o dispositivo.")
    if not accepted:
        return json_error("Você precisa aceitar os termos do teste.")

    ip_value = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    phone_digest = token_hash(phone)
    ip_digest = token_hash(ip_value)

    try:
        reserved = supabase.rpc(
            "reserve_provider_trial",
            {
                "p_name": name,
                "p_phone": phone,
                "p_email": email or None,
                "p_device": device,
                "p_phone_hash": phone_digest,
                "p_ip_hash": ip_digest,
                "p_cooldown_hours": TRIAL_REQUEST_COOLDOWN_HOURS,
                "p_ip_cooldown_hours": TRIAL_IP_COOLDOWN_HOURS,
            },
        ).execute()
    except Exception as exc:
        text = str(exc).lower()
        if "trial_phone_cooldown" in text:
            return json_error("Este WhatsApp já recebeu um teste recentemente.", 409)
        if "trial_ip_cooldown" in text:
            return json_error("Já foi gerado um teste recentemente nesta conexão.", 409)
        app.logger.exception(exc)
        return json_error("Não foi possível registrar a solicitação.", 500)

    row = first(reserved.data)
    if not row or not row.get("request_id"):
        return json_error("Não foi possível reservar o teste.", 500)
    request_id = row["request_id"]

    try:
        result, provider_meta = call_trial_provider({"name": name, "phone": phone, "email": email, "device": device})
        supabase.table("provider_trial_requests").update(
            {
                "status": "success",
                "result_data": result,
                "provider_response": provider_meta,
                "completed_at": iso(utcnow()),
            }
        ).eq("id", request_id).execute()
        audit_event(None, "provider_trial_success", {"request_id": request_id, "device": device})
        return jsonify(
            {
                "message": "Teste gerado com sucesso.",
                "request_id": request_id,
                "customer": {"name": name, "phone_masked": mask_phone(phone), "device": device},
                "trial": result,
            }
        ), 201
    except Exception as exc:
        message = clean_text(str(exc), 1000) or "Falha desconhecida no provedor."
        supabase.table("provider_trial_requests").update(
            {"status": "failed", "error_message": message, "completed_at": iso(utcnow())}
        ).eq("id", request_id).execute()
        audit_event(None, "provider_trial_failed", {"request_id": request_id, "device": device})
        return json_error(f"O teste não foi gerado: {message}", 502)


@app.post("/trial")
@require_user
def create_trial():
    user_id = g.user["id"]
    ip_value = request.headers.get("X-Forwarded-For", request.remote_addr or "unknown").split(",")[0].strip()
    try:
        result = supabase.rpc(
            "claim_trial",
            {
                "p_user_id": user_id,
                "p_email": g.user.get("email"),
                "p_ip_hash": token_hash(ip_value),
                "p_duration_minutes": TRIAL_DURATION_MINUTES,
            },
        ).execute()
    except Exception as exc:
        text = str(exc).lower()
        if "trial_already_used" in text:
            return json_error("Este usuário já utilizou o teste gratuito.", 409)
        if "active_subscription" in text:
            return json_error("Sua conta já possui uma assinatura ativa.", 409)
        app.logger.exception(exc)
        return json_error("Não foi possível ativar o teste.", 500)

    trial_row = first(result.data)
    if not trial_row:
        return json_error("O teste não foi criado.", 500)
    raw_token = issue_access_token(user_id, trial_row.get("subscription_id"), "trial")
    audit_event(user_id, "trial_started", {"duration_minutes": TRIAL_DURATION_MINUTES})
    return jsonify(
        {
            "message": "Teste ativado com sucesso.",
            "ends_at": trial_row.get("trial_ends_at"),
            "access_token": raw_token,
        }
    ), 201


@app.post("/payments/pix")
@require_user
def create_pix_payment():
    body = request.get_json(silent=True) or {}
    plan_id = clean_text(body.get("plan_id"), 80)
    plan = db_one(supabase.table("plans").select("*").eq("id", plan_id).eq("active", True))
    if not plan or plan.get("slug") == "teste-1h":
        return json_error("Plano inválido.", 404)

    payment_result = supabase.table("payments").insert(
        {
            "user_id": g.user["id"],
            "plan_id": plan["id"],
            "amount_cents": int(plan["price_cents"]),
            "currency": "BRL",
            "provider": "pushinpay",
            "status": "pending",
            "created_at": iso(utcnow()),
        }
    ).execute()
    payment = first(payment_result.data)
    if not payment:
        return json_error("Não foi possível registrar o pedido.", 500)

    try:
        charge = create_pushinpay_charge(payment["id"], int(plan["price_cents"]))
    except Exception as exc:
        supabase.table("payments").update({"status": "failed", "provider_response": {"error": str(exc)}}).eq(
            "id", payment["id"]
        ).execute()
        return json_error(f"Pagamento não gerado: {exc}", 502)

    initial_status = charge["status"] if charge["status"] in {"pending", "processing", "failed"} else "pending"
    update = {
        "provider_transaction_id": charge["provider_transaction_id"],
        "provider_response": charge["raw"],
        "status": initial_status,
        "qr_code": charge["qr_code"],
        "copy_paste": charge["copy_paste"],
        "expires_at": charge["expires_at"],
    }
    supabase.table("payments").update(update).eq("id", payment["id"]).execute()
    audit_event(g.user["id"], "pix_created", {"payment_id": payment["id"], "plan_id": plan["id"]})
    return jsonify({"payment": {**payment, **update}, "plan": plan}), 201


@app.get("/payments/<payment_id>")
@require_user
def payment_status(payment_id: str):
    payment = db_one(
        supabase.table("payments")
        .select("*")
        .eq("id", payment_id)
        .eq("user_id", g.user["id"])
    )
    if not payment:
        return json_error("Pagamento não encontrado.", 404)

    sync_error = None
    synced = False
    try:
        payment, _, synced = sync_payment_from_pushinpay(
            payment
        )
    except Exception as exc:
        app.logger.exception(exc)
        sync_error = clean_text(str(exc), 500)

    subscription = current_subscription(g.user["id"])
    public_payment = {
        key: payment.get(key)
        for key in (
            "id",
            "plan_id",
            "amount_cents",
            "status",
            "qr_code",
            "copy_paste",
            "expires_at",
            "paid_at",
            "created_at",
            "provider_transaction_id",
            "last_checked_at",
        )
    }

    return jsonify(
        {
            "payment": public_payment,
            "subscription": subscription,
            "provider_synced": synced,
            "sync_error": sync_error,
        }
    )


@app.post("/payments/<payment_id>/sync")
@require_user
def force_payment_sync(payment_id: str):
    payment = db_one(
        supabase.table("payments")
        .select("*")
        .eq("id", payment_id)
        .eq("user_id", g.user["id"])
    )
    if not payment:
        return json_error("Pagamento não encontrado.", 404)

    if (
        not should_sync_payment(payment)
        and payment.get("status") != "paid"
    ):
        return json_error(
            "Aguarde pelo menos 60 segundos entre as consultas.",
            429,
        )

    try:
        payment, subscription, synced = (
            sync_payment_from_pushinpay(
                payment,
                force=payment.get("status") != "paid",
            )
        )
    except ValueError as exc:
        return json_error(str(exc), 409)
    except Exception as exc:
        app.logger.exception(exc)
        return json_error(
            f"Não foi possível consultar a PushinPay: {exc}",
            502,
        )

    return jsonify(
        {
            "ok": True,
            "provider_synced": synced,
            "payment": {
                "id": payment.get("id"),
                "status": payment.get("status"),
                "paid_at": payment.get("paid_at"),
                "last_checked_at": payment.get("last_checked_at"),
            },
            "subscription": (
                subscription
                or current_subscription(g.user["id"])
            ),
        }
    )


@app.post("/webhooks/pushinpay")
def pushinpay_webhook():
    supplied = request.args.get("token", "")
    if not hmac.compare_digest(
        supplied,
        PUSHINPAY_WEBHOOK_TOKEN,
    ):
        return json_error("Webhook não autorizado.", 401)

    payment_id = clean_text(
        request.args.get("payment_id"),
        80,
    )
    if not payment_id:
        return json_error(
            "Webhook sem identificador interno do pagamento.",
            400,
        )

    payment = db_one(
        supabase.table("payments")
        .select("*")
        .eq("id", payment_id)
    )
    if not payment:
        return json_error("Pagamento não localizado.", 404)

    received_payload = request.get_json(silent=True) or {}

    try:
        if received_payload and provider_status(
            received_payload
        ):
            updated_payment, subscription = (
                apply_pushinpay_status(
                    payment,
                    received_payload,
                    received_webhook=received_payload,
                )
            )
            queried_provider = False
            resolved_payload = received_payload
        else:
            (
                updated_payment,
                subscription,
                queried_provider,
            ) = sync_payment_from_pushinpay(
                payment,
                force=True,
                received_webhook=received_payload,
            )
            resolved_payload = (
                updated_payment.get("last_check_response")
                or {}
            )
    except ValueError as exc:
        return json_error(str(exc), 409)
    except Exception as exc:
        app.logger.exception(exc)
        return json_error(
            f"Falha ao reconciliar pagamento: {exc}",
            502,
        )

    event_hash = hashlib.sha256(
        (
            payment_id
            + json.dumps(
                {
                    "received": received_payload,
                    "resolved": resolved_payload,
                },
                sort_keys=True,
                ensure_ascii=False,
            )
        ).encode("utf-8")
    ).hexdigest()

    prior = db_one(
        supabase.table("webhook_events")
        .select("id")
        .eq("event_hash", event_hash)
    )
    if not prior:
        supabase.table("webhook_events").insert(
            {
                "provider": "pushinpay",
                "event_hash": event_hash,
                "payload": {
                    "received": received_payload,
                    "resolved": resolved_payload,
                },
                "created_at": iso(utcnow()),
            }
        ).execute()

    return jsonify(
        {
            "ok": True,
            "status": updated_payment.get("status"),
            "activated": bool(subscription),
            "subscription_id": (
                subscription.get("id")
                if subscription
                else None
            ),
            "queried_provider": queried_provider,
            "duplicate_event": bool(prior),
        }
    )


@app.post("/access-token/rotate")
@require_user
def rotate_access_token():
    subscription = current_subscription(g.user["id"])
    if not subscription:
        return json_error("É necessário ter uma assinatura ativa.", 403)
    raw = issue_access_token(g.user["id"], subscription.get("id"), "subscription")
    return jsonify({"access_token": raw, "message": "Novo token gerado. O token anterior foi revogado."})


@app.post("/access-token/validate")
def validate_access_token():
    body = request.get_json(silent=True) or {}
    raw = clean_text(body.get("access_token") or request.headers.get("X-Access-Token"), 300)
    if len(raw) < 32:
        return jsonify({"valid": False}), 401
    record = db_one(
        supabase.table("access_tokens")
        .select("id,user_id,subscription_id,kind,revoked_at")
        .eq("token_hash", token_hash(raw))
        .is_("revoked_at", "null")
    )
    if not record:
        return jsonify({"valid": False}), 401
    subscription = db_one(
        supabase.table("subscriptions")
        .select("id,status,ends_at,is_trial")
        .eq("id", record["subscription_id"])
        .eq("user_id", record["user_id"])
    )
    if not subscription or subscription.get("status") != "active" or subscription.get("ends_at", "") <= iso(utcnow()):
        return jsonify({"valid": False, "reason": "subscription_inactive"}), 403
    supabase.table("access_tokens").update({"last_used_at": iso(utcnow())}).eq("id", record["id"]).execute()
    return jsonify(
        {
            "valid": True,
            "user_id": record["user_id"],
            "subscription_id": subscription["id"],
            "is_trial": subscription.get("is_trial", False),
            "expires_at": subscription["ends_at"],
        }
    )


@app.get("/content")
@require_user
def content_catalog():
    subscription = current_subscription(g.user["id"])
    if not subscription:
        return json_error("Assinatura inativa ou expirada.", 403)
    result = supabase.table("content_items").select("id,title,description,category,poster_url").eq("active", True).order(
        "title"
    ).execute()
    audit_event(g.user["id"], "catalog_opened")
    return jsonify({"items": result.data or [], "subscription": subscription})


@app.post("/content/<content_id>/access")
@require_user
def content_access(content_id: str):
    subscription = current_subscription(g.user["id"])
    if not subscription:
        return json_error("Assinatura inativa ou expirada.", 403)
    item = db_one(supabase.table("content_items").select("id,title,provider_asset_id").eq("id", content_id).eq("active", True))
    if not item:
        return json_error("Conteúdo não encontrado.", 404)

    now = utcnow()
    exp = now + timedelta(minutes=ACCESS_TOKEN_TTL_MINUTES)
    signed = jwt.encode(
        {
            "sub": g.user["id"],
            "asset": item["provider_asset_id"],
            "subscription": subscription.get("id"),
            "iat": int(now.timestamp()),
            "exp": int(exp.timestamp()),
        },
        STREAM_SIGNING_SECRET,
        algorithm="HS256",
    )
    audit_event(g.user["id"], "content_accessed", {"content_id": item["id"]})
    return jsonify(
        {
            "title": item["title"],
            "playback_url": f"{LICENSED_STREAM_BASE_URL}/{item['provider_asset_id']}?token={signed}",
            "expires_at": iso(exp),
        }
    )


@app.get("/support/tickets")
@require_user
def user_tickets():
    result = supabase.table("support_tickets").select("*").eq("user_id", g.user["id"]).order(
        "created_at", desc=True
    ).execute()
    return jsonify({"tickets": result.data or []})


@app.post("/support/tickets")
@require_user
def create_ticket():
    body = request.get_json(silent=True) or {}
    subject = clean_text(body.get("subject"), 140)
    message = clean_text(body.get("message"), 4000)
    if len(subject) < 4 or len(message) < 10:
        return json_error("Informe assunto e mensagem com mais detalhes.")
    result = supabase.table("support_tickets").insert(
        {
            "user_id": g.user["id"],
            "subject": subject,
            "message": message,
            "priority": clean_text(body.get("priority") or "normal", 20),
            "status": "open",
            "created_at": iso(utcnow()),
            "updated_at": iso(utcnow()),
        }
    ).execute()
    audit_event(g.user["id"], "support_ticket_created")
    return jsonify({"ticket": first(result.data)}), 201


@app.post("/usage")
@require_user
def record_usage():
    body = request.get_json(silent=True) or {}
    event_type = clean_text(body.get("event_type"), 80)
    if not event_type:
        return json_error("event_type é obrigatório.")
    audit_event(g.user["id"], event_type, body.get("metadata") if isinstance(body.get("metadata"), dict) else {})
    return jsonify({"ok": True})


@app.get("/admin/summary")
@require_admin
def admin_summary():
    days = min(max(int(request.args.get("days", 30)), 1), 365)
    since = iso(utcnow() - timedelta(days=days))
    paid = supabase.table("payments").select("amount_cents,paid_at").eq("status", "paid").gte("paid_at", since).execute().data or []
    active = supabase.table("subscriptions").select("id", count="exact").eq("status", "active").gt(
        "ends_at", iso(utcnow())
    ).execute()
    trials = supabase.table("trial_claims").select("id", count="exact").gte("claimed_at", since).execute()
    tickets = supabase.table("support_tickets").select("id", count="exact").eq("status", "open").execute()
    provider_trials = (supabase.table("provider_trial_requests").select("id", count="exact").eq("status", "success").gte("created_at", since).execute())
    usage = supabase.table("usage_events").select("id", count="exact").gte("created_at", since).execute()
    content_starts = (
        supabase.table("usage_events")
        .select("id", count="exact")
        .eq("event_type", "content_accessed")
        .gte("created_at", since)
        .execute()
    )
    return jsonify(
        {
            "period_days": days,
            "sales_count": len(paid),
            "gross_revenue_cents": sum(int(x.get("amount_cents") or 0) for x in paid),
            "active_subscriptions": active.count or 0,
            "trials_started": trials.count or 0,
            "provider_trials_success": provider_trials.count or 0,
            "open_tickets": tickets.count or 0,
            "usage_events": usage.count or 0,
            "content_starts": content_starts.count or 0,
        }
    )


@app.get("/admin/usage")
@require_admin
def admin_usage():
    days = min(max(int(request.args.get("days", 30)), 1), 365)
    since = iso(utcnow() - timedelta(days=days))
    events = (
        supabase.table("usage_events")
        .select("event_type,created_at")
        .gte("created_at", since)
        .order("created_at")
        .limit(5000)
        .execute()
        .data
        or []
    )
    totals: dict[str, int] = {}
    daily: dict[str, int] = {}
    for event in events:
        event_type = event.get("event_type") or "unknown"
        totals[event_type] = totals.get(event_type, 0) + 1
        day = str(event.get("created_at") or "")[:10]
        if day:
            daily[day] = daily.get(day, 0) + 1
    return jsonify(
        {
            "period_days": days,
            "total": len(events),
            "by_event": totals,
            "daily": [{"date": key, "events": daily[key]} for key in sorted(daily)],
            "truncated": len(events) >= 5000,
        }
    )


@app.get("/admin/payments")
@require_admin
def admin_payments():
    result = (
        supabase.table("payments")
        .select("id,user_id,amount_cents,status,provider,created_at,paid_at,plans(name)")
        .order("created_at", desc=True)
        .limit(100)
        .execute()
    )
    return jsonify({"payments": result.data or []})


@app.get("/admin/provider-trials")
@require_admin
def admin_provider_trials():
    result = (
        supabase.table("provider_trial_requests")
        .select("id,name,phone,email,device,status,result_data,error_message,created_at,completed_at")
        .order("created_at", desc=True)
        .limit(150)
        .execute()
    )
    rows = result.data or []
    for row in rows:
        row["phone_masked"] = mask_phone(row.get("phone") or "")
        row.pop("phone", None)
        data = row.get("result_data") or {}
        if isinstance(data, dict) and data.get("password"):
            data = {**data, "password": "••••••••"}
            row["result_data"] = data
    return jsonify({"trials": rows})


@app.get("/admin/tickets")
@require_admin
def admin_tickets():
    result = supabase.table("support_tickets").select("*").order("created_at", desc=True).limit(100).execute()
    return jsonify({"tickets": result.data or []})


@app.patch("/admin/tickets/<ticket_id>")
@require_admin
def admin_update_ticket(ticket_id: str):
    body = request.get_json(silent=True) or {}
    allowed_status = {"open", "in_progress", "resolved", "closed"}
    status = clean_text(body.get("status"), 30)
    if status not in allowed_status:
        return json_error("Status inválido.")
    update = {
        "status": status,
        "admin_reply": clean_text(body.get("admin_reply"), 4000),
        "updated_at": iso(utcnow()),
    }
    result = supabase.table("support_tickets").update(update).eq("id", ticket_id).execute()
    return jsonify({"ticket": first(result.data)})


@app.errorhandler(404)
def not_found(_):
    return json_error("Rota não encontrada.", 404)


@app.errorhandler(500)
def internal_error(error):
    app.logger.exception(error)
    return json_error("Erro interno. Consulte os logs do backend.", 500)


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "5000")), debug=os.getenv("FLASK_DEBUG") == "1")
