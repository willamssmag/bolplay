import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, BarChart3, Check, CheckCircle2, CircleHelp, Clipboard, Clock3, CreditCard,
  Film, Home as HomeIcon, KeyRound, Loader2, LockKeyhole, LogOut, Menu, MessageCircle,
  Monitor, Play, Server, ShieldCheck, Smartphone, Sparkles, TicketCheck, Tv, UserRound,
  Wifi, X
} from 'lucide-react'
import { supabase } from './supabase'
import { api } from './api'

const AuthContext = createContext(null)
const money = (cents = 0) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
const date = value => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'
const SUPPORT_WHATSAPP = (import.meta.env.VITE_SUPPORT_WHATSAPP || '').replace(/\D/g, '')

function useAuth() { return useContext(AuthContext) }

function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [account, setAccount] = useState(null)
  const [loading, setLoading] = useState(true)

  const refresh = async () => {
    const { data } = await supabase.auth.getSession()
    setSession(data.session)
    if (data.session) {
      try { setAccount(await api('/me')) } catch { setAccount(null) }
    } else setAccount(null)
  }

  useEffect(() => {
    refresh().finally(() => setLoading(false))
    const { data } = supabase.auth.onAuthStateChange(() => refresh())
    return () => data.subscription.unsubscribe()
  }, [])

  const value = useMemo(() => ({ session, account, loading, refresh }), [session, account, loading])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

function Toast({ message, kind = 'success', onClose }) {
  if (!message) return null
  return <div className={`toast ${kind}`}><span>{message}</span><button onClick={onClose}><X size={16}/></button></div>
}

function Layout({ children }) {
  const { session, account } = useAuth()
  const [open, setOpen] = useState(false)
  const location = useLocation()
  useEffect(() => setOpen(false), [location.pathname])

  const logout = async () => { await supabase.auth.signOut(); window.location.href = '/' }
  const links = [
    ['/', 'Início', HomeIcon],
    ['/teste', 'Teste grátis', Sparkles],
    ...(session
      ? [['/painel', 'Minha conta', UserRound], ['/catalogo', 'Catálogo', Film], ['/suporte', 'Suporte', CircleHelp]]
      : [['/entrar', 'Entrar', UserRound]])
  ]
  if (account?.profile?.role === 'admin') links.push(['/admin', 'Administração', BarChart3])

  return <div className="app-shell">
    <header className="topbar">
      <Link to="/" className="brand"><span className="brand-mark"><Play size={18} fill="currentColor"/></span><span>CineVizzo</span></Link>
      <button className="menu-button" onClick={() => setOpen(!open)} aria-label="Abrir menu"><Menu/></button>
      <nav className={open ? 'nav open' : 'nav'}>
        {links.map(([to, label, Icon]) => <Link key={to} to={to} className={location.pathname === to ? 'active' : ''}><Icon size={17}/>{label}</Link>)}
        {session && <button className="nav-logout" onClick={logout}><LogOut size={17}/>Sair</button>}
      </nav>
    </header>
    <main>{children}</main>
    <footer><div><strong>CineVizzo</strong><p>Teste e assinaturas para uma plataforma de conteúdo autorizado.</p></div><span>© 2026 · Atendimento automatizado</span></footer>
  </div>
}

function Protected({ children, admin = false }) {
  const { session, account, loading } = useAuth()
  if (loading) return <PageLoader/>
  if (!session) return <Navigate to="/entrar" replace/>
  if (admin && account?.profile?.role !== 'admin') return <Navigate to="/painel" replace/>
  return children
}

function PageLoader() {
  return <section className="page-center"><Loader2 className="spin" size={34}/><p>Carregando...</p></section>
}

function Home() {
  const { session } = useAuth()
  const [plans, setPlans] = useState([])
  useEffect(() => { api('/plans').then(x => setPlans(x.plans.filter(p => p.slug !== 'teste-1h'))).catch(() => {}) }, [])

  return <>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><Sparkles size={16}/> Teste liberado automaticamente</div>
        <h1>Experimente o CineVizzo por 1 hora.</h1>
        <p>Preencha seus dados, escolha o aparelho e receba as informações do teste na hora. Compatível com Android TV, Fire TV, TV Box, celular e computador.</p>
        <div className="hero-actions">
          <Link className="button primary" to="/teste">Gerar teste de 1 hora<Play size={17}/></Link>
          <Link className="button ghost" to={session ? '/painel' : '/entrar'}>{session ? 'Abrir minha conta' : 'Ver planos'}</Link>
        </div>
        <div className="trust-row"><span><Clock3/>1 hora de teste</span><span><ShieldCheck/>Proteção contra abuso</span><span><Activity/>Liberação automática</span></div>
      </div>
      <div className="hero-card trial-preview-card">
        <div className="screen-head"><span></span><span></span><span></span></div>
        <div className="preview-video"><div className="preview-glow"></div><Tv size={52}/></div>
        <div className="preview-stats"><div><small>Status</small><strong><i></i> Gerado</strong></div><div><small>Duração</small><strong>1 hora</strong></div></div>
        <div className="preview-credentials"><span>Usuário</span><strong>teste••••</strong><span>Senha</span><strong>••••••••</strong></div>
      </div>
    </section>

    <section className="features section">
      <div className="section-heading"><span>COMO FUNCIONA</span><h2>Do formulário ao acesso em poucos passos</h2><p>O endereço do painel permanece protegido no backend e nunca aparece no código do navegador.</p></div>
      <div className="feature-grid">
        {[
          [Smartphone, 'Informe o dispositivo', 'Escolha Android TV, Fire TV, TV Box, celular ou computador.'],
          [Wifi, 'Geração pelo painel', 'O servidor envia a solicitação para sua integração externa de teste.'],
          [TicketCheck, 'Dados exibidos na tela', 'Usuário, senha, servidor, validade e mensagem são organizados automaticamente.'],
          [ShieldCheck, 'Antirrepetição', 'WhatsApp e conexão ficam sujeitos ao período de bloqueio configurado.'],
          [BarChart3, 'Relatórios', 'A administração acompanha tentativas, sucessos, falhas e dispositivos usados.'],
          [MessageCircle, 'Suporte', 'O cliente pode falar com o atendimento depois de receber o teste.']
        ].map(([Icon, title, text]) => <article className="feature-card" key={title}><Icon/><h3>{title}</h3><p>{text}</p></article>)}
      </div>
    </section>

    <section className="plans section" id="planos">
      <div className="section-heading"><span>ASSINATURAS</span><h2>Gostou do teste? Escolha seu plano</h2><p>Os valores podem ser alterados no Supabase e o pagamento Pix continua integrado ao sistema.</p></div>
      <div className="plan-grid">{plans.map((plan, index) => <PlanCard key={plan.id} plan={plan} featured={index === 1}/>)}</div>
    </section>

    <section className="legal-callout section"><ShieldCheck size={38}/><div><h2>Uso autorizado da plataforma</h2><p>Utilize a integração somente para serviços e conteúdos que você tenha autorização para disponibilizar aos clientes.</p></div></section>
  </>
}

function PlanCard({ plan, featured }) {
  const { session } = useAuth()
  return <article className={featured ? 'plan-card featured' : 'plan-card'}>
    {featured && <div className="popular">MAIS ESCOLHIDO</div>}
    <h3>{plan.name}</h3><p>{plan.description}</p>
    <div className="price"><strong>{money(plan.price_cents)}</strong><span>/{plan.duration_days} dias</span></div>
    <ul>{(plan.features || []).map(f => <li key={f}><Check size={17}/>{f}</li>)}</ul>
    <Link className={featured ? 'button primary full' : 'button secondary full'} to={session ? `/painel?plano=${plan.id}` : '/entrar'}>Assinar agora</Link>
  </article>
}

function formatPhone(value) {
  const digits = value.replace(/\D/g, '').slice(0, 11)
  if (digits.length <= 2) return digits
  if (digits.length <= 7) return `(${digits.slice(0, 2)}) ${digits.slice(2)}`
  return `(${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`
}

function CopyField({ label, value, secret = false }) {
  const [copied, setCopied] = useState(false)
  if (!value) return null
  const copy = async () => {
    await navigator.clipboard.writeText(String(value))
    setCopied(true)
    setTimeout(() => setCopied(false), 1300)
  }
  return <div className="credential-field"><div><span>{label}</span><strong className={secret ? 'secret-value' : ''}>{value}</strong></div><button onClick={copy} aria-label={`Copiar ${label}`}>{copied ? <CheckCircle2 size={18}/> : <Clipboard size={18}/>}</button></div>
}

function TrialPage() {
  const [form, setForm] = useState({ name: '', phone: '', email: '', device: 'android_tv', accepted_terms: false, company: '' })
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [toast, setToast] = useState({})

  const submit = async e => {
    e.preventDefault(); setLoading(true); setToast({})
    try {
      const response = await api('/public/trials', { method: 'POST', body: JSON.stringify(form) })
      setResult(response)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch (err) {
      setToast({ message: err.message, kind: 'error' })
    } finally { setLoading(false) }
  }

  const reset = () => { setResult(null); setForm({ name: '', phone: '', email: '', device: 'android_tv', accepted_terms: false, company: '' }) }
  const supportUrl = SUPPORT_WHATSAPP ? `https://wa.me/${SUPPORT_WHATSAPP}?text=${encodeURIComponent('Olá! Preciso de ajuda com meu teste CineVizzo.')}` : null

  if (result) {
    const trial = result.trial || {}
    return <section className="section trial-result-page"><Toast {...toast} onClose={() => setToast({})}/>
      <div className="success-orb"><CheckCircle2 size={42}/></div>
      <div className="section-heading"><span>TESTE GERADO</span><h2>Seu acesso está pronto</h2><p>Salve os dados abaixo e configure no aparelho selecionado. O teste tem duração definida pelo painel fornecedor.</p></div>
      <div className="trial-result-grid">
        <article className="panel result-card">
          <div className="panel-title"><div><KeyRound/><span>Dados de acesso</span></div><span className="badge">1 HORA</span></div>
          <CopyField label="Usuário" value={trial.username}/>
          <CopyField label="Senha" value={trial.password} secret/>
          <CopyField label="Servidor / DNS" value={trial.server}/>
          <CopyField label="Link ou lista" value={trial.playlist_url}/>
          <CopyField label="Validade" value={trial.expires_at}/>
          {!trial.username && !trial.password && <p className="result-note">A integração retornou a mensagem completa abaixo. Use os dados nela informados.</p>}
        </article>
        <article className="panel provider-message-card">
          <div className="panel-title"><div><Server/><span>Resposta do painel</span></div></div>
          <pre>{trial.message || 'Teste criado, mas o painel não retornou uma mensagem.'}</pre>
          <div className="result-actions">
            {supportUrl && <a className="button primary" href={supportUrl} target="_blank" rel="noreferrer"><MessageCircle size={17}/>Falar com suporte</a>}
            <button className="button secondary" onClick={reset}>Voltar ao formulário</button>
          </div>
        </article>
      </div>
      <div className="setup-tips"><h3>Instalação rápida</h3><div><span><Tv/>Android TV / TV Box</span><p>Instale o aplicativo indicado pelo suporte e informe os dados gerados.</p></div><div><span><Monitor/>Fire TV</span><p>Use o aplicativo compatível disponibilizado pela plataforma e faça login.</p></div></div>
    </section>
  }

  return <section className="trial-page section"><Toast {...toast} onClose={() => setToast({})}/>
    <div className="trial-intro">
      <div className="eyebrow"><Sparkles size={16}/> Liberação automática</div>
      <h1>Gere seu teste CineVizzo</h1>
      <p>Preencha o formulário uma única vez. Quando o painel responder, os dados serão mostrados nesta tela.</p>
      <div className="trial-points"><span><Check/>Teste de 1 hora</span><span><Check/>Sem pagamento</span><span><Check/>Liberação imediata</span></div>
    </div>
    <div className="trial-layout">
      <form className="panel trial-form" onSubmit={submit}>
        <div className="panel-title"><div><Tv/><span>Solicitar teste</span></div><span className="badge">GRÁTIS</span></div>
        <div className="form-grid">
          <label>Seu nome<input required minLength="2" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ex.: João Silva"/></label>
          <label>WhatsApp com DDD<input required inputMode="tel" value={form.phone} onChange={e => setForm({ ...form, phone: formatPhone(e.target.value) })} placeholder="(63) 99999-9999"/></label>
          <label className="full-field">E-mail opcional<input type="email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} placeholder="voce@email.com"/></label>
          <label className="full-field">Onde você vai assistir?
            <select value={form.device} onChange={e => setForm({ ...form, device: e.target.value })}>
              <option value="android_tv">Android TV</option><option value="fire_tv">Fire TV Stick</option><option value="tv_box">TV Box</option><option value="smartphone">Celular ou tablet</option><option value="computador">Computador</option><option value="outro">Outro aparelho</option>
            </select>
          </label>
          <label className="honeypot" aria-hidden="true">Empresa<input tabIndex="-1" autoComplete="off" value={form.company} onChange={e => setForm({ ...form, company: e.target.value })}/></label>
        </div>
        <label className="check-row"><input type="checkbox" checked={form.accepted_terms} onChange={e => setForm({ ...form, accepted_terms: e.target.checked })}/><span>Confirmo que usarei o teste apenas para avaliar a plataforma e concordo com o limite de uma solicitação por período.</span></label>
        <button className="button primary full trial-submit" disabled={loading}>{loading ? <><Loader2 className="spin"/>Gerando seu teste...</> : <><Sparkles size={18}/>Gerar teste agora</>}</button>
        <p className="form-footnote"><ShieldCheck size={15}/>A URL do painel e as credenciais de integração ficam somente no backend.</p>
      </form>
      <aside className="trial-aside">
        <article><Clock3/><div><strong>1 hora para experimentar</strong><p>O cronômetro começa de acordo com a regra do painel fornecedor.</p></div></article>
        <article><Smartphone/><div><strong>Vários aparelhos</strong><p>Android TV, Fire TV, TV Box, celular, tablet e computador.</p></div></article>
        <article><ShieldCheck/><div><strong>Controle de duplicidade</strong><p>O sistema impede solicitações repetidas pelo mesmo WhatsApp ou conexão.</p></div></article>
      </aside>
    </div>
  </section>
}

function AuthPage() {
  const { session } = useAuth()
  const navigate = useNavigate()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({ name: '', email: '', password: '' })
  const [loading, setLoading] = useState(false)
  const [toast, setToast] = useState({})
  if (session) return <Navigate to="/painel" replace/>

  const submit = async e => {
    e.preventDefault(); setLoading(true); setToast({})
    try {
      if (mode === 'signup') {
        const { error } = await supabase.auth.signUp({ email: form.email, password: form.password, options: { data: { full_name: form.name } } })
        if (error) throw error
        setToast({ message: 'Cadastro criado. Verifique seu e-mail caso a confirmação esteja habilitada.' })
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
        if (error) throw error
        navigate('/painel')
      }
    } catch (err) { setToast({ message: err.message, kind: 'error' }) } finally { setLoading(false) }
  }

  return <section className="auth-page"><Toast {...toast} onClose={() => setToast({})}/>
    <aside className="auth-aside"><div className="eyebrow"><ShieldCheck/>Área protegida</div><h1>Gerencie assinatura e atendimento em um só lugar.</h1><p>Entre para gerar Pix, acompanhar a assinatura, acessar o catálogo autorizado e falar com o suporte.</p><div className="auth-benefits"><span><Check/>Pagamento Pix</span><span><Check/>Ativação automática</span><span><Check/>Suporte integrado</span></div></aside>
    <form className="auth-card" onSubmit={submit}><div className="mini-label">{mode === 'login' ? 'BEM-VINDO' : 'NOVA CONTA'}</div><h2>{mode === 'login' ? 'Entrar no CineVizzo' : 'Criar sua conta'}</h2><p>{mode === 'login' ? 'Use seu e-mail e senha.' : 'Cadastre-se para escolher um plano.'}</p>{mode === 'signup' && <label>Nome completo<input required value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}/></label>}<label>E-mail<input type="email" required value={form.email} onChange={e => setForm({ ...form, email: e.target.value })}/></label><label>Senha<input type="password" required minLength="6" value={form.password} onChange={e => setForm({ ...form, password: e.target.value })}/></label><button className="button primary full" disabled={loading}>{loading ? <Loader2 className="spin"/> : mode === 'login' ? 'Entrar' : 'Cadastrar'}</button><button type="button" className="text-button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Ainda não tenho conta' : 'Já tenho conta'}</button></form>
  </section>
}

function Dashboard() {
  const { account, refresh } = useAuth()
  const [plans, setPlans] = useState([]), [loading, setLoading] = useState(''), [payment, setPayment] = useState(null), [accessToken, setAccessToken] = useState(''), [toast, setToast] = useState({})
  useEffect(() => { api('/plans').then(x => setPlans(x.plans.filter(p => p.slug !== 'teste-1h'))) }, [])
  useEffect(() => { const id = new URLSearchParams(window.location.search).get('plano'); if (id) buy(id) }, [])
  const sub = account?.subscription
  const copy = async value => { if (!value) return; await navigator.clipboard.writeText(value); setToast({ message: 'Copiado.' }) }
  const buy = async planId => { setLoading(planId); try { const r = await api('/payments/pix', { method: 'POST', body: JSON.stringify({ plan_id: planId }) }); setPayment(r.payment) } catch (e) { setToast({ message: e.message, kind: 'error' }) } finally { setLoading('') } }
  const rotate = async () => { setLoading('token'); try { const r = await api('/access-token/rotate', { method: 'POST', body: '{}' }); setAccessToken(r.access_token) } catch (e) { setToast({ message: e.message, kind: 'error' }) } finally { setLoading('') } }
  useEffect(() => { if (!payment || payment.status === 'paid') return; const timer = setInterval(async () => { try { const r = await api(`/payments/${payment.id}`); setPayment(r.payment); if (r.payment.status === 'paid') { await refresh(); setToast({ message: 'Pagamento confirmado e assinatura ativada.' }) } } catch {} }, 5000); return () => clearInterval(timer) }, [payment?.id, payment?.status])

  return <section className="section narrow"><Toast {...toast} onClose={() => setToast({})}/><div className="dashboard-heading"><div><span className="mini-label">MINHA CONTA</span><h1>Olá, {account?.profile?.full_name?.split(' ')[0] || 'cliente'}</h1><p>Acompanhe seu acesso e seus pagamentos.</p></div><span className={sub ? 'status active' : 'status inactive'}><i></i>{sub ? 'Acesso ativo' : 'Sem assinatura'}</span></div>
    <div className="dashboard-grid"><article className="panel subscription-panel"><div className="panel-title"><div><Tv/><span>Seu acesso</span></div><span className="badge">{sub?.is_trial ? 'TESTE' : sub?.plans?.name || 'INATIVO'}</span></div>{sub ? <><h2>{sub.is_trial ? 'Período de avaliação' : sub.plans?.name}</h2><p>Seu acesso está liberado até:</p><div className="big-date">{date(sub.ends_at)}</div><div className="progress"><span style={{ width: '72%' }}></span></div><div className="panel-actions"><Link className="button primary" to="/catalogo"><Play size={17}/>Abrir catálogo</Link><button className="button secondary" onClick={rotate} disabled={loading === 'token'}><KeyRound size={17}/>Gerar token</button></div></> : <><h2>Experimente antes de assinar</h2><p>Gere uma avaliação automática de 1 hora usando a integração do seu painel.</p><Link className="button primary" to="/teste"><Sparkles size={17}/>Gerar teste de 1 hora</Link></>}</article><article className="panel account-panel"><div className="panel-title"><div><UserRound/><span>Cadastro</span></div></div><dl><div><dt>Nome</dt><dd>{account?.profile?.full_name || 'Não informado'}</dd></div><div><dt>E-mail</dt><dd>{account?.user?.email}</dd></div><div><dt>Perfil</dt><dd>{account?.profile?.role === 'admin' ? 'Administrador' : 'Cliente'}</dd></div></dl></article></div>
    {accessToken && <article className="panel token-box"><div><KeyRound/><span><strong>Token gerado</strong><small>Copie agora. Por segurança, ele não será mostrado novamente.</small></span></div><code>{accessToken}</code><button className="icon-button" onClick={() => copy(accessToken)}><Clipboard/></button></article>}
    <div className="section-heading align-left"><span>RENOVE OU ASSINE</span><h2>Planos disponíveis</h2></div><div className="compact-plan-grid">{plans.map(p => <article className="compact-plan" key={p.id}><div><h3>{p.name}</h3><p>{p.duration_days} dias de acesso</p></div><strong>{money(p.price_cents)}</strong><button className="button secondary" onClick={() => buy(p.id)} disabled={loading === p.id}>{loading === p.id ? <Loader2 className="spin"/> : 'Gerar Pix'}</button></article>)}</div>
    {payment && <PaymentModal payment={payment} onClose={() => setPayment(null)} copy={copy}/>} 
  </section>
}

function PaymentModal({ payment, onClose, copy }) {
  const paid = payment.status === 'paid'
  const imageSrc = payment.qr_code && (payment.qr_code.startsWith('data:') ? payment.qr_code : payment.qr_code.length > 300 ? `data:image/png;base64,${payment.qr_code}` : null)
  return <div className="modal-backdrop"><div className="modal"><button className="modal-close" onClick={onClose}><X/></button><div className={paid ? 'payment-icon paid' : 'payment-icon'}>{paid ? <Check/> : <CreditCard/>}</div><h2>{paid ? 'Pagamento confirmado' : 'Pague com Pix'}</h2><p>{paid ? 'Sua assinatura foi ativada automaticamente.' : 'Abra o aplicativo do banco, escaneie o QR Code ou copie o código.'}</p>{!paid && <>{imageSrc && <img className="qr" src={imageSrc} alt="QR Code Pix"/>}<div className="pix-code"><code>{payment.copy_paste || 'O provedor não retornou o código copia e cola.'}</code><button onClick={() => copy(payment.copy_paste)} disabled={!payment.copy_paste}><Clipboard/></button></div><span className="waiting"><Loader2 className="spin"/>Aguardando confirmação automática...</span></>}{paid && <button className="button primary full" onClick={onClose}>Continuar</button>}</div></div>
}

function Catalog() {
  const [data, setData] = useState(null), [toast, setToast] = useState({}), [loading, setLoading] = useState('')
  useEffect(() => { api('/content').then(setData).catch(e => setToast({ message: e.message, kind: 'error' })) }, [])
  const play = async id => { setLoading(id); try { const r = await api(`/content/${id}/access`, { method: 'POST', body: '{}' }); window.open(r.playback_url, '_blank', 'noopener,noreferrer') } catch (e) { setToast({ message: e.message, kind: 'error' }) } finally { setLoading('') } }
  if (!data && !toast.message) return <PageLoader/>
  return <section className="section narrow"><Toast {...toast} onClose={() => setToast({})}/><div className="dashboard-heading"><div><span className="mini-label">CATÁLOGO PROTEGIDO</span><h1>Conteúdo disponível</h1><p>Os links são temporários e exigem uma assinatura ativa.</p></div></div><div className="catalog-grid">{(data?.items || []).map(item => <article className="content-card" key={item.id}><div className="poster">{item.poster_url ? <img src={item.poster_url} alt=""/> : <Film/>}<button onClick={() => play(item.id)}>{loading === item.id ? <Loader2 className="spin"/> : <Play fill="currentColor"/>}</button></div><span>{item.category}</span><h3>{item.title}</h3><p>{item.description}</p></article>)}</div></section>
}

function Support() {
  const [tickets, setTickets] = useState([]), [form, setForm] = useState({ subject: '', message: '', priority: 'normal' }), [loading, setLoading] = useState(false), [toast, setToast] = useState({})
  const load = () => api('/support/tickets').then(x => setTickets(x.tickets))
  useEffect(() => { load() }, [])
  const submit = async e => { e.preventDefault(); setLoading(true); try { await api('/support/tickets', { method: 'POST', body: JSON.stringify(form) }); setForm({ subject: '', message: '', priority: 'normal' }); await load(); setToast({ message: 'Chamado aberto com sucesso.' }) } catch (e) { setToast({ message: e.message, kind: 'error' }) } finally { setLoading(false) } }
  return <section className="section narrow"><Toast {...toast} onClose={() => setToast({})}/><div className="dashboard-heading"><div><span className="mini-label">SUPORTE TÉCNICO</span><h1>Como podemos ajudar?</h1><p>Abra um chamado e acompanhe a resposta pelo painel.</p></div></div><div className="support-grid"><form className="panel support-form" onSubmit={submit}><h2>Novo chamado</h2><label>Assunto<input required value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })}/></label><label>Prioridade<select value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label><label>Mensagem<textarea required rows="6" value={form.message} onChange={e => setForm({ ...form, message: e.target.value })}></textarea></label><button className="button primary" disabled={loading}>{loading ? <Loader2 className="spin"/> : 'Enviar chamado'}</button></form><div className="ticket-list"><h2>Meus chamados</h2>{tickets.length === 0 ? <div className="empty"><CircleHelp/><p>Nenhum chamado aberto.</p></div> : tickets.map(t => <article className="ticket" key={t.id}><div><strong>{t.subject}</strong><span className={`ticket-status ${t.status}`}>{t.status.replace('_', ' ')}</span></div><p>{t.message}</p>{t.admin_reply && <blockquote><strong>Resposta:</strong> {t.admin_reply}</blockquote>}<small>{date(t.created_at)}</small></article>)}</div></div></section>
}

function Admin() {
  const [summary, setSummary] = useState(null), [payments, setPayments] = useState([]), [tickets, setTickets] = useState([]), [trials, setTrials] = useState([]), [toast, setToast] = useState({})
  const load = async () => { try { const [s, p, t, tr] = await Promise.all([api('/admin/summary'), api('/admin/payments'), api('/admin/tickets'), api('/admin/provider-trials')]); setSummary(s); setPayments(p.payments); setTickets(t.tickets); setTrials(tr.trials) } catch (e) { setToast({ message: e.message, kind: 'error' }) } }
  useEffect(() => { load() }, [])
  const resolve = async id => { try { await api(`/admin/tickets/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'resolved', admin_reply: 'Chamado analisado e marcado como resolvido pela administração.' }) }); load() } catch (e) { setToast({ message: e.message, kind: 'error' }) } }
  if (!summary && !toast.message) return <PageLoader/>
  return <section className="section narrow admin-page"><Toast {...toast} onClose={() => setToast({})}/><div className="dashboard-heading"><div><span className="mini-label">ADMINISTRAÇÃO</span><h1>Visão geral da operação</h1><p>Indicadores dos últimos {summary?.period_days} dias.</p></div></div>
    <div className="metric-grid">{[
      ['Receita bruta', money(summary?.gross_revenue_cents), CreditCard], ['Vendas', summary?.sales_count, BarChart3], ['Assinaturas ativas', summary?.active_subscriptions, Activity], ['Testes do painel', summary?.provider_trials_success, Sparkles], ['Chamados abertos', summary?.open_tickets, CircleHelp], ['Reproduções', summary?.content_starts, Play]
    ].map(([label, value, Icon]) => <article className="metric" key={label}><Icon/><span>{label}</span><strong>{value}</strong></article>)}</div>
    <div className="panel table-panel admin-trials-panel"><div className="panel-title"><div><Sparkles/><span>Últimas solicitações de teste</span></div></div><div className="table-wrap"><table><thead><tr><th>Data</th><th>Cliente</th><th>WhatsApp</th><th>Dispositivo</th><th>Status</th><th>Usuário</th></tr></thead><tbody>{trials.map(t => <tr key={t.id}><td>{date(t.created_at)}</td><td>{t.name}</td><td>{t.phone_masked}</td><td>{t.device}</td><td><span className={`ticket-status ${t.status}`}>{t.status}</span></td><td>{t.result_data?.username || '—'}</td></tr>)}</tbody></table></div></div>
    <div className="admin-grid"><div className="panel table-panel"><div className="panel-title"><div><CreditCard/><span>Últimos pagamentos</span></div></div><div className="table-wrap"><table><thead><tr><th>Data</th><th>Plano</th><th>Valor</th><th>Status</th></tr></thead><tbody>{payments.map(p => <tr key={p.id}><td>{date(p.created_at)}</td><td>{p.plans?.name || '—'}</td><td>{money(p.amount_cents)}</td><td><span className={`ticket-status ${p.status}`}>{p.status}</span></td></tr>)}</tbody></table></div></div><div className="panel"><div className="panel-title"><div><CircleHelp/><span>Chamados recentes</span></div></div><div className="admin-ticket-list">{tickets.slice(0, 8).map(t => <article key={t.id}><div><strong>{t.subject}</strong><small>{date(t.created_at)}</small></div><span className={`ticket-status ${t.status}`}>{t.status}</span>{t.status !== 'resolved' && <button onClick={() => resolve(t.id)}>Resolver</button>}</article>)}</div></div></div>
  </section>
}

function App() {
  return <AuthProvider><Layout><Routes>
    <Route path="/" element={<Home/>}/><Route path="/teste" element={<TrialPage/>}/><Route path="/entrar" element={<AuthPage/>}/>
    <Route path="/painel" element={<Protected><Dashboard/></Protected>}/><Route path="/catalogo" element={<Protected><Catalog/></Protected>}/>
    <Route path="/suporte" element={<Protected><Support/></Protected>}/><Route path="/admin" element={<Protected admin><Admin/></Protected>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></Layout></AuthProvider>
}

export default App
