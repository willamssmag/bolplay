import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  Activity, BarChart3, Check, CircleHelp, Clipboard, CreditCard, Film, Home as HomeIcon,
  KeyRound, Loader2, LockKeyhole, LogOut, Menu, Play, ShieldCheck, Sparkles, TicketCheck, Tv, UserRound, X
} from 'lucide-react'
import { supabase } from './supabase'
import { api } from './api'

const AuthContext = createContext(null)
const money = (cents = 0) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cents / 100)
const date = (value) => value ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value)) : '—'

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
  const links = session ? [
    ['/', 'Início', HomeIcon], ['/painel', 'Minha conta', UserRound], ['/catalogo', 'Catálogo', Film], ['/suporte', 'Suporte', CircleHelp]
  ] : [['/', 'Início', HomeIcon], ['/entrar', 'Entrar', UserRound]]
  if (account?.profile?.role === 'admin') links.push(['/admin', 'Administração', BarChart3])

  return <div className="app-shell">
    <header className="topbar">
      <Link to="/" className="brand"><span className="brand-mark"><Play size={18} fill="currentColor"/></span><span>StreamHub</span></Link>
      <button className="menu-button" onClick={() => setOpen(!open)} aria-label="Abrir menu"><Menu/></button>
      <nav className={open ? 'nav open' : 'nav'}>
        {links.map(([to, label, Icon]) => <Link key={to} to={to} className={location.pathname === to ? 'active' : ''}><Icon size={17}/>{label}</Link>)}
        {session && <button className="nav-logout" onClick={logout}><LogOut size={17}/>Sair</button>}
      </nav>
    </header>
    <main>{children}</main>
    <footer><div><strong>StreamHub</strong><p>Infraestrutura para distribuição de conteúdo audiovisual licenciado.</p></div><span>© 2026 · Uso legal e autorizado</span></footer>
  </div>
}

function Protected({ children, admin = false }) {
  const { session, account, loading } = useAuth()
  if (loading) return <PageLoader/>
  if (!session) return <Navigate to="/entrar" replace/>
  if (admin && account?.profile?.role !== 'admin') return <Navigate to="/painel" replace/>
  return children
}

function PageLoader() { return <section className="page-center"><Loader2 className="spin" size={34}/><p>Carregando...</p></section> }

function Home() {
  const { session } = useAuth()
  const [plans, setPlans] = useState([])
  useEffect(() => { api('/plans').then(x => setPlans(x.plans.filter(p => p.slug !== 'teste-1h'))).catch(() => {}) }, [])
  return <>
    <section className="hero">
      <div className="hero-copy">
        <div className="eyebrow"><Sparkles size={16}/> Plataforma de assinaturas automatizada</div>
        <h1>Venda acesso ao seu conteúdo licenciado com ativação automática.</h1>
        <p>Cadastro, Pix, teste de 1 hora, webhook, controle de acesso, suporte e relatórios em uma experiência simples para celular e computador.</p>
        <div className="hero-actions">
          <Link className="button primary" to={session ? '/painel' : '/entrar'}>{session ? 'Abrir meu painel' : 'Criar minha conta'}<Play size={17}/></Link>
          <a className="button ghost" href="#planos">Ver planos</a>
        </div>
        <div className="trust-row"><span><ShieldCheck/>Acesso protegido</span><span><CreditCard/>Pix integrado</span><span><Activity/>Ativação automática</span></div>
      </div>
      <div className="hero-card">
        <div className="screen-head"><span></span><span></span><span></span></div>
        <div className="preview-video"><div className="preview-glow"></div><Play size={42} fill="currentColor"/></div>
        <div className="preview-stats"><div><small>Status</small><strong><i></i> Ativo</strong></div><div><small>Expira em</small><strong>29 dias</strong></div></div>
        <div className="preview-line"><span></span><span></span><span></span></div>
      </div>
    </section>

    <section className="features section">
      <div className="section-heading"><span>TECNOLOGIA</span><h2>Tudo o que a operação precisa</h2><p>Uma base moderna para comercializar assinaturas sem liberar o conteúdo antes da confirmação.</p></div>
      <div className="feature-grid">
        {[
          [LockKeyhole, 'Autenticação segura', 'Contas gerenciadas pelo Supabase Auth e dados separados por políticas RLS.'],
          [CreditCard, 'Pagamento Pix', 'Cobrança gerada no servidor, sem revelar sua credencial da PushinPay.'],
          [TicketCheck, 'Teste de 1 hora', 'Avaliação única por conta, com início e expiração registrados automaticamente.'],
          [BarChart3, 'Painel administrativo', 'Receita, vendas, assinaturas ativas, testes e chamados em um só lugar.'],
          [KeyRound, 'Tokens de acesso', 'Tokens rotativos e links temporários para proteger a entrega do conteúdo.'],
          [CircleHelp, 'Suporte integrado', 'Abertura e acompanhamento de chamados dentro da área do cliente.']
        ].map(([Icon,title,text]) => <article className="feature-card" key={title}><Icon/><h3>{title}</h3><p>{text}</p></article>)}
      </div>
    </section>

    <section className="plans section" id="planos">
      <div className="section-heading"><span>PLANOS</span><h2>Escolha a duração ideal</h2><p>Valores de demonstração podem ser alterados diretamente na tabela de planos.</p></div>
      <div className="plan-grid">
        {plans.map((plan, index) => <PlanCard key={plan.id} plan={plan} featured={index === 1}/>) }
      </div>
    </section>

    <section className="legal-callout section"><ShieldCheck size={38}/><div><h2>Conteúdo legal, negócio sustentável</h2><p>Use esta plataforma somente para canais, filmes, eventos ou materiais sobre os quais você possua autorização, licença ou direitos de distribuição.</p></div></section>
  </>
}

function PlanCard({ plan, featured }) {
  const { session } = useAuth()
  return <article className={featured ? 'plan-card featured' : 'plan-card'}>
    {featured && <div className="popular">MAIS ESCOLHIDO</div>}
    <h3>{plan.name}</h3><p>{plan.description}</p><div className="price"><strong>{money(plan.price_cents)}</strong><span>/{plan.duration_days} dias</span></div>
    <ul>{(plan.features || []).map(f => <li key={f}><Check size={17}/>{f}</li>)}</ul>
    <Link className={featured ? 'button primary full' : 'button secondary full'} to={session ? `/painel?plano=${plan.id}` : '/entrar'}>Assinar agora</Link>
  </article>
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

  return <section className="auth-page">
    <Toast {...toast} onClose={() => setToast({})}/>
    <div className="auth-aside"><div className="eyebrow"><Tv size={16}/> STREAMHUB</div><h1>Seu entretenimento autorizado, disponível em qualquer tela.</h1><p>Acesse sua conta, gerencie a assinatura e fale com o suporte.</p><div className="auth-benefits"><span><Check/>Ativação automática</span><span><Check/>Pagamento por Pix</span><span><Check/>Ambiente protegido</span></div></div>
    <form className="auth-card" onSubmit={submit}>
      <div><span className="mini-label">ÁREA DO CLIENTE</span><h2>{mode === 'login' ? 'Bem-vindo de volta' : 'Crie sua conta'}</h2><p>{mode === 'login' ? 'Entre para acessar seu painel.' : 'Preencha os dados para começar.'}</p></div>
      {mode === 'signup' && <label>Nome completo<input required value={form.name} onChange={e => setForm({...form, name:e.target.value})} placeholder="Seu nome"/></label>}
      <label>E-mail<input type="email" required value={form.email} onChange={e => setForm({...form, email:e.target.value})} placeholder="voce@email.com"/></label>
      <label>Senha<input type="password" minLength="8" required value={form.password} onChange={e => setForm({...form, password:e.target.value})} placeholder="Mínimo de 8 caracteres"/></label>
      <button className="button primary full" disabled={loading}>{loading ? <Loader2 className="spin"/> : mode === 'login' ? 'Entrar' : 'Criar conta'}</button>
      <button type="button" className="text-button" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Ainda não tenho conta' : 'Já tenho uma conta'}</button>
    </form>
  </section>
}

function Dashboard() {
  const { account, refresh } = useAuth()
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState('')
  const [toast, setToast] = useState({})
  const [payment, setPayment] = useState(null)
  const [accessToken, setAccessToken] = useState('')

  useEffect(() => { api('/plans').then(x => setPlans(x.plans.filter(p => p.slug !== 'teste-1h'))) }, [])
  useEffect(() => {
    if (!payment?.id || payment.status === 'paid') return
    const timer = setInterval(async () => {
      try { const data = await api(`/payments/${payment.id}`); setPayment(data.payment); if (data.payment.status === 'paid') { await refresh(); setToast({message:'Pagamento confirmado e assinatura ativada!'}) } } catch {}
    }, 7000)
    return () => clearInterval(timer)
  }, [payment?.id, payment?.status])

  const trial = async () => {
    setLoading('trial'); try { const data = await api('/trial', {method:'POST', body:'{}'}); setAccessToken(data.access_token); setToast({message:data.message}); await refresh() } catch(e) {setToast({message:e.message,kind:'error'})} finally {setLoading('')}
  }
  const buy = async planId => {
    setLoading(planId); try { const data = await api('/payments/pix',{method:'POST',body:JSON.stringify({plan_id:planId})}); setPayment(data.payment); setToast({message:'Pix gerado. Pague e aguarde a confirmação automática.'}) } catch(e){setToast({message:e.message,kind:'error'})} finally{setLoading('')}
  }
  const rotate = async () => {
    setLoading('token'); try {const data=await api('/access-token/rotate',{method:'POST',body:'{}'});setAccessToken(data.access_token);setToast({message:data.message})}catch(e){setToast({message:e.message,kind:'error'})}finally{setLoading('')}
  }
  const copy = async text => { await navigator.clipboard.writeText(text); setToast({message:'Copiado para a área de transferência.'}) }

  const sub = account?.subscription
  return <section className="dashboard section narrow">
    <Toast {...toast} onClose={() => setToast({})}/>
    <div className="dashboard-heading"><div><span className="mini-label">MINHA CONTA</span><h1>Olá, {account?.profile?.full_name || account?.user?.email}</h1><p>Acompanhe seu acesso e gerencie sua assinatura.</p></div><div className={sub ? 'status active' : 'status inactive'}><i></i>{sub ? 'Assinatura ativa' : 'Sem assinatura'}</div></div>

    <div className="dashboard-grid">
      <article className="panel subscription-panel"><div className="panel-title"><div><Tv/><span>Seu acesso</span></div><span className="badge">{sub?.is_trial ? 'TESTE' : sub?.plans?.name || 'INATIVO'}</span></div>
        {sub ? <><h2>{sub.is_trial ? 'Período de avaliação' : sub.plans?.name}</h2><p>Seu acesso está liberado até:</p><div className="big-date">{date(sub.ends_at)}</div><div className="progress"><span style={{width:'72%'}}></span></div><div className="panel-actions"><Link className="button primary" to="/catalogo"><Play size={17}/>Abrir catálogo</Link><button className="button secondary" onClick={rotate} disabled={loading==='token'}><KeyRound size={17}/>Gerar token</button></div></> : <><h2>Comece com 1 hora grátis</h2><p>Ative o teste único para validar a experiência antes de escolher um plano.</p><button className="button primary" onClick={trial} disabled={loading==='trial'}>{loading==='trial'?<Loader2 className="spin"/>:<Sparkles size={17}/>}Ativar teste de 1 hora</button></>}
      </article>
      <article className="panel account-panel"><div className="panel-title"><div><UserRound/><span>Cadastro</span></div></div><dl><div><dt>Nome</dt><dd>{account?.profile?.full_name || 'Não informado'}</dd></div><div><dt>E-mail</dt><dd>{account?.user?.email}</dd></div><div><dt>Perfil</dt><dd>{account?.profile?.role === 'admin' ? 'Administrador' : 'Cliente'}</dd></div></dl></article>
    </div>

    {accessToken && <article className="panel token-box"><div><KeyRound/><span><strong>Token gerado</strong><small>Copie agora. Por segurança, ele não será mostrado novamente.</small></span></div><code>{accessToken}</code><button className="icon-button" onClick={()=>copy(accessToken)}><Clipboard/></button></article>}

    <div className="section-heading align-left"><span>RENOVE OU ASSINE</span><h2>Planos disponíveis</h2></div>
    <div className="compact-plan-grid">{plans.map(p => <article className="compact-plan" key={p.id}><div><h3>{p.name}</h3><p>{p.duration_days} dias de acesso</p></div><strong>{money(p.price_cents)}</strong><button className="button secondary" onClick={()=>buy(p.id)} disabled={loading===p.id}>{loading===p.id?<Loader2 className="spin"/>:'Gerar Pix'}</button></article>)}</div>

    {payment && <PaymentModal payment={payment} onClose={()=>setPayment(null)} copy={copy}/>} 
  </section>
}

function PaymentModal({ payment, onClose, copy }) {
  const paid = payment.status === 'paid'
  const imageSrc = payment.qr_code && (payment.qr_code.startsWith('data:') ? payment.qr_code : payment.qr_code.length > 300 ? `data:image/png;base64,${payment.qr_code}` : null)
  return <div className="modal-backdrop"><div className="modal"><button className="modal-close" onClick={onClose}><X/></button><div className={paid?'payment-icon paid':'payment-icon'}>{paid?<Check/>:<CreditCard/>}</div><h2>{paid?'Pagamento confirmado':'Pague com Pix'}</h2><p>{paid?'Sua assinatura foi ativada automaticamente.':'Abra o aplicativo do banco, escaneie o QR Code ou copie o código.'}</p>
    {!paid && <>{imageSrc && <img className="qr" src={imageSrc} alt="QR Code Pix"/>}<div className="pix-code"><code>{payment.copy_paste || 'O provedor não retornou o código copia e cola.'}</code><button onClick={()=>copy(payment.copy_paste)} disabled={!payment.copy_paste}><Clipboard/></button></div><span className="waiting"><Loader2 className="spin"/>Aguardando confirmação automática...</span></>}
    {paid && <button className="button primary full" onClick={onClose}>Continuar</button>}
  </div></div>
}

function Catalog() {
  const [data, setData] = useState(null), [toast,setToast]=useState({}), [loading,setLoading]=useState('')
  useEffect(()=>{api('/content').then(setData).catch(e=>setToast({message:e.message,kind:'error'}))},[])
  const play = async id => {setLoading(id);try{const r=await api(`/content/${id}/access`,{method:'POST',body:'{}'});window.open(r.playback_url,'_blank','noopener,noreferrer')}catch(e){setToast({message:e.message,kind:'error'})}finally{setLoading('')}}
  if (!data && !toast.message) return <PageLoader/>
  return <section className="section narrow"><Toast {...toast} onClose={()=>setToast({})}/><div className="dashboard-heading"><div><span className="mini-label">CATÁLOGO PROTEGIDO</span><h1>Conteúdo disponível</h1><p>Os links são temporários e exigem uma assinatura ativa.</p></div></div><div className="catalog-grid">{(data?.items||[]).map(item=><article className="content-card" key={item.id}><div className="poster">{item.poster_url?<img src={item.poster_url}/>:<Film/>}<button onClick={()=>play(item.id)}>{loading===item.id?<Loader2 className="spin"/>:<Play fill="currentColor"/>}</button></div><span>{item.category}</span><h3>{item.title}</h3><p>{item.description}</p></article>)}</div></section>
}

function Support() {
  const [tickets,setTickets]=useState([]),[form,setForm]=useState({subject:'',message:'',priority:'normal'}),[loading,setLoading]=useState(false),[toast,setToast]=useState({})
  const load=()=>api('/support/tickets').then(x=>setTickets(x.tickets))
  useEffect(()=>{load()},[])
  const submit=async e=>{e.preventDefault();setLoading(true);try{await api('/support/tickets',{method:'POST',body:JSON.stringify(form)});setForm({subject:'',message:'',priority:'normal'});await load();setToast({message:'Chamado aberto com sucesso.'})}catch(e){setToast({message:e.message,kind:'error'})}finally{setLoading(false)}}
  return <section className="section narrow"><Toast {...toast} onClose={()=>setToast({})}/><div className="dashboard-heading"><div><span className="mini-label">SUPORTE TÉCNICO</span><h1>Como podemos ajudar?</h1><p>Abra um chamado e acompanhe a resposta pelo painel.</p></div></div><div className="support-grid"><form className="panel support-form" onSubmit={submit}><h2>Novo chamado</h2><label>Assunto<input required value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})}/></label><label>Prioridade<select value={form.priority} onChange={e=>setForm({...form,priority:e.target.value})}><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label><label>Mensagem<textarea required rows="6" value={form.message} onChange={e=>setForm({...form,message:e.target.value})}></textarea></label><button className="button primary" disabled={loading}>{loading?<Loader2 className="spin"/>:'Enviar chamado'}</button></form><div className="ticket-list"><h2>Meus chamados</h2>{tickets.length===0?<div className="empty"><CircleHelp/><p>Nenhum chamado aberto.</p></div>:tickets.map(t=><article className="ticket" key={t.id}><div><strong>{t.subject}</strong><span className={`ticket-status ${t.status}`}>{t.status.replace('_',' ')}</span></div><p>{t.message}</p>{t.admin_reply&&<blockquote><strong>Resposta:</strong> {t.admin_reply}</blockquote>}<small>{date(t.created_at)}</small></article>)}</div></div></section>
}

function Admin() {
  const [summary,setSummary]=useState(null),[payments,setPayments]=useState([]),[tickets,setTickets]=useState([]),[toast,setToast]=useState({})
  const load=async()=>{try{const [s,p,t]=await Promise.all([api('/admin/summary'),api('/admin/payments'),api('/admin/tickets')]);setSummary(s);setPayments(p.payments);setTickets(t.tickets)}catch(e){setToast({message:e.message,kind:'error'})}}
  useEffect(()=>{load()},[])
  const resolve=async id=>{try{await api(`/admin/tickets/${id}`,{method:'PATCH',body:JSON.stringify({status:'resolved',admin_reply:'Chamado analisado e marcado como resolvido pela administração.'})});load()}catch(e){setToast({message:e.message,kind:'error'})}}
  if(!summary&&!toast.message)return <PageLoader/>
  return <section className="section narrow admin-page"><Toast {...toast} onClose={()=>setToast({})}/><div className="dashboard-heading"><div><span className="mini-label">ADMINISTRAÇÃO</span><h1>Visão geral da operação</h1><p>Indicadores dos últimos {summary?.period_days} dias.</p></div></div><div className="metric-grid">{[
    ['Receita bruta',money(summary?.gross_revenue_cents),CreditCard],['Vendas',summary?.sales_count,BarChart3],['Assinaturas ativas',summary?.active_subscriptions,Activity],['Testes iniciados',summary?.trials_started,Sparkles],['Chamados abertos',summary?.open_tickets,CircleHelp],['Reproduções',summary?.content_starts,Play]
  ].map(([label,value,Icon])=><article className="metric" key={label}><Icon/><span>{label}</span><strong>{value}</strong></article>)}</div><div className="admin-grid"><div className="panel table-panel"><div className="panel-title"><div><CreditCard/><span>Últimos pagamentos</span></div></div><div className="table-wrap"><table><thead><tr><th>Data</th><th>Plano</th><th>Valor</th><th>Status</th></tr></thead><tbody>{payments.map(p=><tr key={p.id}><td>{date(p.created_at)}</td><td>{p.plans?.name||'—'}</td><td>{money(p.amount_cents)}</td><td><span className={`ticket-status ${p.status}`}>{p.status}</span></td></tr>)}</tbody></table></div></div><div className="panel"><div className="panel-title"><div><CircleHelp/><span>Chamados recentes</span></div></div><div className="admin-ticket-list">{tickets.slice(0,8).map(t=><article key={t.id}><div><strong>{t.subject}</strong><small>{date(t.created_at)}</small></div><span className={`ticket-status ${t.status}`}>{t.status}</span>{t.status!=='resolved'&&<button onClick={()=>resolve(t.id)}>Resolver</button>}</article>)}</div></div></div></section>
}

function App() {
  return <AuthProvider><Layout><Routes>
    <Route path="/" element={<Home/>}/><Route path="/entrar" element={<AuthPage/>}/>
    <Route path="/painel" element={<Protected><Dashboard/></Protected>}/>
    <Route path="/catalogo" element={<Protected><Catalog/></Protected>}/>
    <Route path="/suporte" element={<Protected><Support/></Protected>}/>
    <Route path="/admin" element={<Protected admin><Admin/></Protected>}/>
    <Route path="*" element={<Navigate to="/" replace/>}/>
  </Routes></Layout></AuthProvider>
}

export default App
