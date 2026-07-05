# CineVizzo — site de teste automático de 1 hora

Atualização do projeto de vendas e assinaturas com uma página pública que gera testes usando o link do **Painel Slim** (ou outro fornecedor autorizado) sem revelar esse endereço no navegador.

> Use o projeto somente para um serviço e conteúdos que você tenha autorização para comercializar e distribuir.

## O que foi adicionado

- Página pública `/teste`
- Formulário com nome, WhatsApp, e-mail opcional e dispositivo
- Compatibilidade visual com Android TV, Fire TV Stick, TV Box, celular e computador
- Chamada da integração externa somente pelo backend Flask
- Método `POST`, pois o link de chatbot não funciona como uma página comum
- Modo automático de integração:
  1. tenta `POST` sem corpo;
  2. em erro `400`, `415` ou `422`, tenta JSON com nome, telefone e dispositivo
- Leitura de resposta em JSON ou texto simples
- Extração automática de usuário, senha, servidor/DNS, link/lista e validade
- Botões para copiar cada informação
- Mensagem original do painel preservada para formatos não reconhecidos
- Bloqueio configurável por WhatsApp e por IP
- Reserva atômica no Supabase para evitar dois testes simultâneos
- Registro de sucesso e falha
- Relatório dos testes no painel administrativo
- Modo simulado para testar o site sem consumir um teste real

O restante do projeto continua incluído:

- React + Vite responsivo
- Flask
- Supabase Auth, banco e RLS
- PushinPay Pix e webhook
- Assinaturas e tokens
- Catálogo protegido
- Suporte técnico
- Relatórios administrativos
- Deploy separado de frontend e backend na Vercel

## Estrutura

```text
cinevizzo-testes-painelslim/
├── backend/
│   ├── app.py
│   ├── requirements.txt
│   ├── vercel.json
│   └── .env.example
├── frontend/
│   ├── src/
│   ├── package.json
│   ├── vercel.json
│   └── .env.example
├── supabase/
│   ├── schema.sql
│   ├── migration_provider_trials.sql
│   └── make_admin.sql
└── README.md
```

# Instalação

## 1. Atualizar o Supabase

### Projeto novo

No **SQL Editor** do Supabase, execute todo o arquivo:

```text
supabase/schema.sql
```

### Projeto StreamHub já instalado

Execute apenas:

```text
supabase/migration_provider_trials.sql
```

A migração cria:

- tabela `provider_trial_requests`;
- índices de telefone, IP e status;
- política RLS de leitura para administradores;
- função `reserve_provider_trial` para proteção contra repetição.

## 2. Configurar o backend

Na Vercel, abra o projeto do backend e cadastre as variáveis de `backend/.env.example`.

As variáveis novas são:

```env
TRIAL_PROVIDER_URL=https://painelslim.site/api/chatbot/SEU-CODIGO/SEU-TOKEN
TRIAL_PROVIDER_METHOD=POST
TRIAL_PROVIDER_BODY_MODE=auto
TRIAL_PROVIDER_HEADERS_JSON={}
TRIAL_PROVIDER_TIMEOUT_SECONDS=30
TRIAL_PROVIDER_VERIFY_SSL=true
TRIAL_PROVIDER_MOCK=false
TRIAL_REQUEST_COOLDOWN_HOURS=720
TRIAL_IP_COOLDOWN_HOURS=6
```

### Variável mais importante

Em `TRIAL_PROVIDER_URL`, cole o link que você recebeu do Painel Slim.

**Não coloque esse link:**

- no React;
- em `VITE_*`;
- em HTML público;
- em repositório público do GitHub.

Cadastre-o diretamente em **Vercel > Projeto backend > Settings > Environment Variables**.

## 3. Primeiro teste sem consumir acesso real

No backend use:

```env
TRIAL_PROVIDER_MOCK=true
```

Faça deploy e abra:

```text
https://SEU-FRONTEND.vercel.app/teste
```

Preencha o formulário. O sistema deve mostrar usuário, senha, servidor e validade de demonstração.

Depois altere para:

```env
TRIAL_PROVIDER_MOCK=false
```

Faça novo deploy para usar o Painel Slim.

## 4. Escolher o formato da chamada

Comece com:

```env
TRIAL_PROVIDER_BODY_MODE=auto
```

O backend faz:

1. `POST` sem corpo;
2. se o servidor responder `400`, `415` ou `422`, envia este JSON aproximado:

```json
{
  "name": "João Silva",
  "nome": "João Silva",
  "phone": "5563999999999",
  "telefone": "5563999999999",
  "whatsapp": "5563999999999",
  "email": "cliente@email.com",
  "device": "android_tv",
  "dispositivo": "android_tv"
}
```

Também é possível forçar:

```env
TRIAL_PROVIDER_BODY_MODE=empty
```

ou:

```env
TRIAL_PROVIDER_BODY_MODE=json
```

ou:

```env
TRIAL_PROVIDER_BODY_MODE=form
```

Caso o fornecedor exija um cabeçalho, informe como JSON:

```env
TRIAL_PROVIDER_HEADERS_JSON={"Authorization":"Bearer SEU_TOKEN"}
```

## 5. Configurar o frontend

No projeto frontend da Vercel:

```env
VITE_SUPABASE_URL=https://SEU-PROJETO.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_xxx
VITE_API_URL=https://SEU-BACKEND.vercel.app
VITE_APP_NAME=CineVizzo
VITE_SUPPORT_WHATSAPP=5563999999999
```

`VITE_SUPPORT_WHATSAPP` é opcional. Use somente números, incluindo `55` e DDD.

## 6. Deploy na Vercel

Use dois projetos apontando para o mesmo repositório.

### Backend

- Root Directory: `backend`
- Cadastre todas as variáveis do backend
- Faça deploy
- Teste `https://SEU-BACKEND.vercel.app/health`

### Frontend

- Root Directory: `frontend`
- Framework: Vite
- Cadastre as variáveis `VITE_*`
- Faça deploy

Depois atualize no backend:

```env
FRONTEND_URL=https://SEU-FRONTEND.vercel.app
PUBLIC_BACKEND_URL=https://SEU-BACKEND.vercel.app
```

Faça novo deploy do backend.

## 7. Criar administrador

1. Cadastre uma conta no site.
2. Abra `supabase/make_admin.sql`.
3. Troque o e-mail de exemplo pelo e-mail cadastrado.
4. Execute no SQL Editor.
5. Saia e entre novamente.

O painel **Administração** mostrará as solicitações de teste.

# Proteção contra testes repetidos

Padrão:

```env
TRIAL_REQUEST_COOLDOWN_HOURS=720
TRIAL_IP_COOLDOWN_HOURS=6
```

Isso representa:

- mesmo WhatsApp: novo teste após 30 dias;
- mesma conexão/IP: novo teste após 6 horas.

Exemplo para permitir novamente após 7 dias:

```env
TRIAL_REQUEST_COOLDOWN_HOURS=168
```

Solicitações com status `failed` podem ser tentadas novamente. Solicitações `processing` ou `success` entram no bloqueio.

# Respostas aceitas do painel

O backend entende JSON como:

```json
{
  "username": "cliente123",
  "password": "senha123",
  "server": "http://servidor.exemplo",
  "expires_at": "2026-07-04T22:00:00Z",
  "message": "Teste criado"
}
```

Também entende texto como:

```text
Usuário: cliente123
Senha: senha123
Servidor: http://servidor.exemplo
Validade: 1 hora
```

Se os nomes forem diferentes, a resposta completa ainda aparecerá na área “Resposta do painel”.

# Rotas novas

| Método | Rota | Função |
|---|---|---|
| POST | `/public/trials` | Reserva e gera um teste externo |
| GET | `/admin/provider-trials` | Lista os testes para administradores |

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

## Frontend

```bash
cd frontend
npm install
cp .env.example .env.local
npm run dev
```

Acesse `http://localhost:5173/teste`.

# Observação importante sobre a integração fornecida

Foi possível confirmar que o endereço informado não aceita uma abertura normal por `GET`. Como não foi possível disparar um `POST` real sem criar/consumir um teste da sua conta, o projeto utiliza um adaptador configurável e modo simulado. Depois do deploy, faça primeiro um teste controlado. Se o fornecedor usar um corpo diferente, altere apenas `call_trial_provider()` em `backend/app.py` ou ajuste o modo de corpo pelas variáveis acima.

## Correção: `column "paid_at" does not exist`

Esse erro acontece quando o projeto Supabase já possuía uma tabela `public.payments` criada por outro sistema. O comando `create table if not exists` preserva a tabela antiga e não acrescenta automaticamente colunas novas.

No SQL Editor, execute primeiro:

```sql
alter table public.payments
  add column if not exists paid_at timestamptz;
```

Depois execute novamente `supabase/schema.sql` inteiro. O arquivo corrigido também já contém essa compatibilidade. Como alternativa, execute `supabase/fix_paid_at.sql`.

# Correção para erro de instalação na Vercel

Se aparecer `npm error Exit handler never called`, use os arquivos desta versão e confirme no projeto frontend:

- Root Directory: `frontend`
- Framework: `Vite`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`
- Node.js: `22.x`

Em seguida faça um redeploy sem reutilizar o cache. Consulte `DEPLOY-VERCEL.md`.
