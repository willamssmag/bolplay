# StreamHub — assinaturas de streaming/IPTV licenciado

Sistema completo para vender assinaturas de **conteúdo audiovisual que você esteja legalmente autorizado a distribuir**. O projeto não inclui listas, canais, filmes, credenciais de terceiros, técnicas para contornar DRM ou fontes não licenciadas.

## O que já está implementado

- React + Vite, responsivo para celular e computador
- Cadastro, login e sessão com Supabase Auth
- Planos mensal, trimestral e anual editáveis
- Teste automático de 1 hora, limitado a uma utilização por conta
- Integração Pix PushinPay feita somente no backend
- Webhook idempotente com validação de token, pagamento, identificador e valor
- Ativação e renovação automática da assinatura
- Token de acesso rotativo, armazenado somente como hash
- Catálogo protegido e links de reprodução temporários com JWT
- Relatórios de receita, vendas, assinaturas, testes e suporte
- Chamados de suporte dentro da área do cliente
- Row Level Security no Supabase
- Projetos separados para deploy independente na Vercel

## Estrutura

```text
streamhub-iptv-legal/
├── backend/                 API Flask e integração PushinPay
│   ├── app.py
│   ├── requirements.txt
│   ├── vercel.json
│   └── .env.example
├── frontend/                React + Vite
│   ├── src/
│   ├── package.json
│   ├── vercel.json
│   └── .env.example
└── supabase/
    ├── schema.sql           tabelas, políticas, funções e dados iniciais
    └── make_admin.sql       transforma um usuário em administrador
```

# Instalação passo a passo

## 1. Criar o projeto no Supabase

1. Entre no painel do Supabase e crie um projeto.
2. Abra **SQL Editor**.
3. Copie todo o conteúdo de `supabase/schema.sql`.
4. Execute o SQL.
5. Em **Authentication > Providers > Email**, mantenha e-mail/senha ativado.
6. Em **Authentication > URL Configuration**, depois do deploy adicione a URL do frontend em `Site URL` e nas URLs permitidas de redirecionamento.

O SQL cria tabelas, índices, RLS, gatilho de perfil, função atômica de teste e planos iniciais.

## 2. Obter as chaves do Supabase

Em **Project Settings > API**, copie:

- Project URL
- Publishable/anon key
- Secret/service role key

A chave secreta é usada apenas no backend. Nunca coloque essa chave no React, em arquivos públicos ou no GitHub.

## 3. Configurar a PushinPay

Você precisa de uma conta aprovada e de um token de API.

O backend usa por padrão:

```text
POST https://api.pushinpay.com.br/api/pix/cashIn
```

Envia:

```json
{
  "value": 2990,
  "webhook_url": "https://seu-backend.vercel.app/webhooks/pushinpay?...",
  "split_rules": []
}
```

O valor é enviado em centavos. A URL de webhook é montada automaticamente para cada pedido.

> Se a sua conta PushinPay estiver com lista branca de IP habilitada, verifique a compatibilidade com o IP de saída da Vercel. Funções serverless normalmente não oferecem um único IP fixo sem configuração adicional.

## 4. Publicar o backend na Vercel

1. Envie a pasta completa para um repositório GitHub.
2. Na Vercel, clique em **Add New > Project**.
3. Importe o repositório.
4. Em **Root Directory**, escolha `backend`.
5. Cadastre as variáveis usando `backend/.env.example` como modelo:

```env
SUPABASE_URL=https://SEU-PROJETO.supabase.co
SUPABASE_ANON_KEY=sb_publishable_xxx
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxx
FRONTEND_URL=https://temporario.vercel.app
PUBLIC_BACKEND_URL=https://seu-backend.vercel.app
PUSHINPAY_TOKEN=seu-token
PUSHINPAY_CASHIN_URL=https://api.pushinpay.com.br/api/pix/cashIn
PUSHINPAY_WEBHOOK_TOKEN=uma-chave-longa-e-aleatoria
STREAM_SIGNING_SECRET=outra-chave-longa-e-aleatoria
LICENSED_STREAM_BASE_URL=https://stream.seudominio.com/watch
TRIAL_DURATION_MINUTES=60
ACCESS_TOKEN_TTL_MINUTES=5
PAYMENT_MOCK=false
```

6. Faça o deploy.
7. Abra `https://seu-backend.vercel.app/health`. Deve retornar `ok: true`.
8. Atualize `PUBLIC_BACKEND_URL` com a URL definitiva e faça novo deploy.

Para gerar segredos fortes localmente:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

## 5. Publicar o frontend na Vercel

1. Crie outro projeto na Vercel apontando para o mesmo repositório.
2. Em **Root Directory**, escolha `frontend`.
3. O framework será detectado como Vite.
4. Cadastre:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
VITE_API_URL=https://seu-backend.vercel.app
VITE_APP_NAME=StreamHub
```

5. Faça o deploy.
6. Copie a URL final do frontend.
7. Volte ao projeto do backend e altere `FRONTEND_URL` para a URL final.
8. Faça um novo deploy do backend.
9. Adicione a URL do frontend nas configurações de URL do Supabase Auth.

## 6. Criar o administrador

1. Cadastre normalmente a conta que será administradora pelo site.
2. Abra `supabase/make_admin.sql`.
3. Troque `admin@seudominio.com` pelo e-mail cadastrado.
4. Execute no SQL Editor.
5. Saia e entre novamente no site.

A opção **Administração** aparecerá no menu.

## 7. Conectar seu servidor de streaming licenciado

A rota:

```text
POST /content/:id/access
```

verifica a assinatura e gera um JWT temporário. O backend monta:

```text
LICENSED_STREAM_BASE_URL/PROVIDER_ASSET_ID?token=JWT_TEMPORARIO
```

Seu servidor/CDN precisa validar `STREAM_SIGNING_SECRET`, algoritmo `HS256`, expiração, usuário e identificador do conteúdo. Substitua os itens de demonstração da tabela `content_items` pelos ativos que você tem autorização para distribuir.

Para provedores que usam URLs assinadas próprias, adapte somente a função `content_access()` em `backend/app.py`.

# Execução local

## Backend

```bash
cd backend
python -m venv .venv
```

Windows:

```bash
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
python app.py
```

Linux/macOS:

```bash
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
python app.py
```

API local: `http://localhost:5000`

## Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Frontend local: `http://localhost:5173`

# Testar sem cobrar Pix real

No backend, use:

```env
PAYMENT_MOCK=true
```

Gere uma cobrança pelo painel. Depois simule a confirmação substituindo os valores:

```bash
curl -X POST "http://localhost:5000/webhooks/pushinpay?token=SEU_WEBHOOK_TOKEN&payment_id=UUID_DO_PAGAMENTO" \
  -H "Content-Type: application/json" \
  -d '{"status":"paid","transaction_id":"mock_TRANSACAO","value":2990}'
```

No modo mock, o identificador enviado no webhook deve ser o mesmo mostrado em `provider_transaction_id` no registro da tabela `payments`. Somente em `PAYMENT_MOCK=true` o campo pode ser omitido. Em produção, o backend exige que o identificador recebido confira com a cobrança criada.

# Rotas principais

| Método | Rota | Função |
|---|---|---|
| GET | `/health` | saúde da API |
| GET | `/plans` | lista pública de planos |
| GET | `/me` | perfil e assinatura atual |
| POST | `/trial` | cria teste único de 1 hora |
| POST | `/payments/pix` | cria cobrança PushinPay |
| GET | `/payments/:id` | consulta pagamento do usuário |
| POST | `/webhooks/pushinpay` | confirmação e ativação automática |
| POST | `/access-token/rotate` | revoga e gera novo token |
| POST | `/access-token/validate` | valida token para integração externa |
| GET | `/content` | catálogo protegido |
| POST | `/content/:id/access` | link temporário de reprodução |
| GET/POST | `/support/tickets` | chamados do cliente |
| GET | `/admin/summary` | indicadores administrativos |
| GET | `/admin/payments` | últimas vendas |
| GET | `/admin/usage` | estatísticas de uso por evento e dia |
| GET/PATCH | `/admin/tickets` | gestão de suporte |

# Ajustes recomendados antes de produção

- Troque nome, textos, cores, logotipo e valores dos planos.
- Configure domínio próprio e HTTPS.
- Ative confirmação de e-mail e proteção contra abuso no Supabase Auth.
- Configure logs e alertas na Vercel.
- Confirme no painel/documentação da sua conta PushinPay os nomes exatos enviados no webhook. O conector já aceita variações comuns, mas provedores podem alterar versões e formatos.
- Crie política de privacidade, termos de uso, política de reembolso e identificação empresarial.
- Faça revisão jurídica dos direitos de distribuição e da LGPD.
- Não armazene senha de painel IPTV, lista M3U ou credenciais de terceiros no navegador.

# Observação sobre “ativação IPTV”

Este projeto ativa a assinatura dentro do Supabase e libera acesso protegido ao conteúdo. Caso você possua um painel autorizado de gestão de assinantes, crie um adaptador servidor-a-servidor dentro de `activate_subscription()` usando a API oficial desse fornecedor. Nunca exponha a credencial desse painel no frontend.
