# CORREÇÃO DO WEBHOOK PUSHINPAY
# Arquivo: backend/app.py
#
# 1) Adicione esta variável logo após PUSHINPAY_CASHIN_URL:
#
# PUSHINPAY_TRANSACTION_URL = env(
#     "PUSHINPAY_TRANSACTION_URL",
#     "https://api.pushinpay.com.br/api/transactions/{id}",
# )
#
# 2) Adicione esta função logo após create_pushinpay_charge(...):

def fetch_pushinpay_transaction(provider_transaction_id: str) -> dict:
    if not PUSHINPAY_TOKEN:
        raise RuntimeError("PUSHINPAY_TOKEN não configurado.")

    url = PUSHINPAY_TRANSACTION_URL.format(id=provider_transaction_id)
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

    if response.status_code >= 400:
        message = (
            payload.get("message")
            if isinstance(payload, dict)
            else "Falha ao consultar a PushinPay"
        )
        raise RuntimeError(clean_text(message or "Falha ao consultar a PushinPay", 500))

    if isinstance(payload, list):
        payload = payload[0] if payload else {}

    if not isinstance(payload, dict):
        raise RuntimeError("Resposta inválida ao consultar a PushinPay.")

    return payload


# 3) Substitua TODA a função pushinpay_webhook atual por esta:

@app.post("/webhooks/pushinpay")
def pushinpay_webhook():
    supplied = request.args.get("token", "")
    if not hmac.compare_digest(supplied, PUSHINPAY_WEBHOOK_TOKEN):
        return json_error("Webhook não autorizado.", 401)

    payment_id = clean_text(request.args.get("payment_id"), 80)
    if not payment_id:
        return json_error("Webhook sem identificador interno do pagamento.", 400)

    payment = db_one(
        supabase.table("payments")
        .select("*")
        .eq("id", payment_id)
    )
    if not payment:
        return json_error("Pagamento não localizado.", 404)

    received_payload = request.get_json(silent=True) or {}
    payload = received_payload

    # Algumas notificações da PushinPay podem chegar sem corpo JSON.
    # Nesse caso, consulta a transação usando o ID salvo na criação do PIX.
    status_from_body = clean_text(
        deep_get(payload, ("status", "payment_status", "paymentStatus", "type")),
        80,
    ).lower()

    if not status_from_body:
        provider_transaction_id = clean_text(
            payment.get("provider_transaction_id"),
            160,
        )
        if not provider_transaction_id:
            return json_error(
                "Pagamento sem identificador da transação na PushinPay.",
                409,
            )

        try:
            payload = fetch_pushinpay_transaction(provider_transaction_id)
        except Exception as exc:
            app.logger.exception(exc)
            return json_error(
                f"Não foi possível consultar a transação: {exc}",
                502,
            )

    status_raw = clean_text(
        deep_get(payload, ("status", "payment_status", "paymentStatus", "type")),
        80,
    ).lower()

    provider_id = clean_text(
        deep_get(
            payload,
            ("transaction_id", "transactionId", "pix_id", "pixId", "id"),
        ),
        160,
    )

    amount_raw = deep_get(
        payload,
        ("value", "amount", "amount_cents", "value_cents"),
    )

    # Valida o ID retornado pela PushinPay.
    expected_provider_id = clean_text(
        payment.get("provider_transaction_id"),
        160,
    )
    if expected_provider_id:
        if not provider_id and not PAYMENT_MOCK:
            return json_error(
                "PushinPay não retornou o identificador da transação.",
                409,
            )
        if provider_id and provider_id != expected_provider_id:
            return json_error(
                "Identificador da transação não confere.",
                409,
            )

    # Valida o valor retornado.
    if amount_raw not in (None, ""):
        try:
            raw_number = float(amount_raw)
            expected = int(payment["amount_cents"])
            candidates = {
                int(round(raw_number)),
                int(round(raw_number * 100)),
            }
            if expected not in candidates:
                return json_error(
                    "Valor da transação não confere.",
                    409,
                )
        except (TypeError, ValueError):
            return json_error("Valor inválido na transação.", 400)

    # O hash é criado após a consulta/normalização.
    event_hash = hashlib.sha256(
        (
            payment_id
            + json.dumps(payload, sort_keys=True, ensure_ascii=False)
        ).encode("utf-8")
    ).hexdigest()

    prior = db_one(
        supabase.table("webhook_events")
        .select("id")
        .eq("event_hash", event_hash)
    )
    if prior:
        return jsonify({"ok": True, "duplicate": True})

    paid_statuses = {
        "paid",
        "approved",
        "completed",
        "confirmed",
        "pix_paid",
        "payment.paid",
    }

    status_map = {
        "created": "pending",
        "pending": "pending",
        "processing": "processing",
        "failed": "failed",
        "cancelled": "cancelled",
        "canceled": "cancelled",
        "expired": "expired",
        "refunded": "refunded",
    }

    if status_raw in paid_statuses:
        if payment.get("status") != "paid":
            supabase.table("payments").update(
                {
                    "status": "paid",
                    "paid_at": iso(utcnow()),
                    "webhook_payload": payload,
                }
            ).eq("id", payment["id"]).execute()

            payment["status"] = "paid"
            subscription = activate_subscription(payment)

            audit_event(
                payment["user_id"],
                "subscription_activated",
                {"payment_id": payment["id"]},
            )

            supabase.table("webhook_events").insert(
                {
                    "provider": "pushinpay",
                    "event_hash": event_hash,
                    "payload": {
                        "received": received_payload,
                        "resolved": payload,
                    },
                    "created_at": iso(utcnow()),
                }
            ).execute()

            return jsonify(
                {
                    "ok": True,
                    "activated": True,
                    "subscription_id": subscription.get("id"),
                }
            )

        return jsonify({"ok": True, "already_paid": True})

    safe_status = status_map.get(status_raw, payment["status"])

    supabase.table("payments").update(
        {
            "webhook_payload": payload,
            "status": safe_status,
        }
    ).eq("id", payment["id"]).execute()

    supabase.table("webhook_events").insert(
        {
            "provider": "pushinpay",
            "event_hash": event_hash,
            "payload": {
                "received": received_payload,
                "resolved": payload,
            },
            "created_at": iso(utcnow()),
        }
    ).execute()

    return jsonify(
        {
            "ok": True,
            "status": safe_status,
            "provider_status": status_raw or None,
        }
    )
