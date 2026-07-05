# Correção do deploy na Vercel

O frontend e o backend devem ser publicados como **dois projetos separados** apontando para o mesmo repositório.

## Projeto do frontend

Em **Vercel > Project > Settings > Build and Deployment**:

- Root Directory: `frontend`
- Framework Preset: `Vite`
- Install Command: `npm install`
- Build Command: `npm run build`
- Output Directory: `dist`
- Node.js Version: `22.x`

Depois cadastre as variáveis `VITE_*` do arquivo `frontend/.env.example` e faça um novo deploy sem cache.

## Projeto do backend

- Root Directory: `backend`
- Framework Preset: `Other`
- O arquivo `backend/vercel.json` configura a API Flask.

Cadastre todas as variáveis de `backend/.env.example`.

## Erro "Exit handler never called"

A versão anterior do `frontend/package-lock.json` registrava URLs de um repositório privado usado durante a geração do pacote. Essas URLs não podem ser acessadas pela Vercel. Nesta versão:

- os campos `resolved` ligados ao repositório privado foram removidos;
- `frontend/.npmrc` força o registro público `https://registry.npmjs.org/`;
- o Node foi fixado em `22.x`.

Após substituir os arquivos no GitHub, abra **Deployments**, selecione o último deploy e use **Redeploy**, desmarcando o uso do cache de build.
