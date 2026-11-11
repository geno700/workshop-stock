// App shell: login, navigation and routing.
import { html, render, useState, useEffect } from './lib.js';
import { db, demoMode } from './data.js';
import { config } from '../config.js';
import { toast, ask, go, lastWorkshop, rememberWorkshop } from './ui.js';
import { Dashboard, Items, ItemDetail, ItemForm } from './views-items.js';
import { History, Team } from './views-other.js';
import { Locations, Labels } from './views-places.js';
import { Projects, ProjectDetail, Suppliers, ImportItems } from './views-manage.js';
import { Voice } from './voice.js';
import { WorkshopManager, Workshops } from './views-workshop.js';

// An invite link looks like .../?join=CODE. Keep the code until the person has signed in.
const INVITE_KEY = 'workshop-stock-invite';
{
  const url = new URL(location.href);
  const code = url.searchParams.get('join');
  if (code) {
    try {
      sessionStorage.setItem(INVITE_KEY, code);
    } catch {
      // Storage blocked: the person can still type the code in.
    }
    url.searchParams.delete('join');
    history.replaceState(null, '', url);
  }
}
function takeInvite(clear) {
  try {
    const code = sessionStorage.getItem(INVITE_KEY);
    if (clear) sessionStorage.removeItem(INVITE_KEY);
    return code;
  } catch {
    return null;
  }
}

function useRoute() {
  // Sign-in links put their own data after the #, which is not a page of this app.
  const read = () => (location.hash.startsWith('#/') ? location.hash.slice(1) : '/');
  const [route, setRoute] = useState(read());
  useEffect(() => {
    const onChange = () => {
      setRoute(read());
      scrollTo(0, 0);
    };
    addEventListener('hashchange', onChange);
    return () => removeEventListener('hashchange', onChange);
  }, []);
  return route;
}

function Brand({ name = config.workshopName }) {
  return html`<a class="brand" href="#/"><span class="brand-mark"></span><span class="brand-name">${name}</span></a>`;
}

function Login() {
  const [mode, setMode] = useState('in'); // in | up | reset
  const [f, setF] = useState({ email: '', password: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const to = (m) => { setMode(m); setError(''); setNotice(''); };

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'in') await db.signIn(f.email.trim(), f.password);
      else if (mode === 'reset') {
        await db.sendPasswordReset(f.email.trim());
        setNotice('If this email has an account, a link to set a new password is on its way.');
      } else {
        const res = await db.signUp(f.email.trim(), f.password, f.name.trim());
        if (res.needsConfirm) setNotice('Check your email and open the confirmation link, then sign in here.');
      }
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  const title = { in: 'Sign in', up: 'Create account', reset: 'Reset password' }[mode];

  return html`
    <div class="auth">
      <${Brand} />
      <form class="card pad form" onSubmit=${submit}>
        <h1>${title}</h1>
        ${takeInvite() && html`<p class="small">You have been invited to a workshop. Sign in or create an account to join it.</p>`}
        ${notice && html`<p class="small">${notice}</p>`}
        ${error && html`<p class="error">${error}</p>`}
        ${mode === 'up' &&
        html`<label><span>Your name</span><input required value=${f.name} onInput=${set('name')} autocomplete="name" /></label>`}
        <label><span>Email</span><input type="email" required value=${f.email} onInput=${set('email')} autocomplete="email" /></label>
        ${mode !== 'reset' &&
        html`<label>
          <span>Password</span>
          <input type="password" required minlength="6" value=${f.password} onInput=${set('password')}
            autocomplete=${mode === 'in' ? 'current-password' : 'new-password'} />
        </label>`}
        <button class="btn primary" disabled=${busy}>${mode === 'reset' ? 'Send reset link' : title}</button>
      </form>
      <p class="switch">
        ${mode === 'in' ? 'New here? ' : mode === 'up' ? 'Already have an account? ' : ''}
        <button type="button" onClick=${() => to(mode === 'in' ? 'up' : 'in')}>
          ${mode === 'in' ? 'Create an account' : mode === 'up' ? 'Sign in' : 'Back to sign in'}
        </button>
      </p>
      ${mode === 'in' &&
      html`<p class="switch"><button type="button" onClick=${() => to('reset')}>Forgot your password?</button></p>`}
    </div>
  `;
}

function SetPassword({ onDone }) {
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await db.setPassword(password);
      toast('Password changed');
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return html`
    <div class="auth">
      <${Brand} />
      <form class="card pad form" onSubmit=${submit}>
        <h1>Choose a new password</h1>
        ${error && html`<p class="error">${error}</p>`}
        <label>
          <span>New password</span>
          <input type="password" required minlength="6" value=${password} onInput=${(e) => setPassword(e.target.value)}
            autocomplete="new-password" />
        </label>
        <button class="btn primary" disabled=${busy}>Save password</button>
      </form>
    </div>
  `;
}

// Shown when the person has no workshop to open: none yet, or still waiting for approval.
function Welcome({ auth, onChange }) {
  const waiting = auth.current?.role === 'pending';
  return html`
    <div class="auth wide">
      <${Brand} />
      <div class="card pad form" style="margin-bottom:16px">
        <h1>${waiting ? 'Waiting for approval' : 'Welcome'}</h1>
        <p class="muted">
          ${waiting
            ? `Your request to join ${auth.current.name} has been sent. An admin there needs to give you access before you can see the stock.`
            : 'Join the workshop you were invited to, or start your own and invite your team.'}
        </p>
        <div class="actions">
          ${waiting && html`<button class="btn" onClick=${onChange}>Check again</button>`}
          ${!demoMode && html`<button class="btn" onClick=${() => db.signOut()}>Sign out (${auth.profile?.email})</button>`}
        </div>
      </div>
      <${WorkshopManager} workshops=${auth.workshops} current=${auth.current} onChange=${onChange} />
    </div>
  `;
}

function App() {
  const route = useRoute();
  const [auth, setAuth] = useState({ loading: true });

  async function refresh() {
    try {
      const user = await db.getUser();
      if (!user) return setAuth({ user: null });
      const profile = await db.getProfile();

      const invite = takeInvite(true);
      if (invite && !db.inRecovery()) {
        try {
          const before = await db.listWorkshops();
          const w = await db.joinWorkshop(invite);
          rememberWorkshop(w.id);
          const had = before.find((x) => x.id === w.id);
          toast(
            had && had.role !== 'pending'
              ? `You are already in ${w.name}`
              : `Request sent to ${w.name}. An admin there needs to approve you.`,
          );
        } catch (err) {
          toast(err.message, true);
        }
      }

      const workshops = await db.listWorkshops();
      const last = lastWorkshop();
      const current =
        workshops.find((w) => w.id === last) ?? workshops.find((w) => w.role !== 'pending') ?? workshops[0] ?? null;
      if (current) db.useWorkshop(current.id);
      setAuth({ user, profile, workshops, current });
    } catch (err) {
      setAuth({ error: err.message });
    }
  }
  useEffect(() => {
    refresh();
    return db.onAuthChange(refresh);
  }, []);

  if (auth.loading) return html`<p class="boot">Loading…</p>`;
  if (auth.error) return html`<p class="state">Could not connect: ${auth.error}</p>`;
  if (!auth.user) return html`<${Login} />`;
  if (db.inRecovery()) return html`<${SetPassword} onDone=${refresh} />`;

  const role = auth.current?.role ?? 'pending';
  if (role === 'pending') return html`<${Welcome} auth=${auth} onChange=${refresh} />`;

  const me = { ...auth.profile, role, canEdit: role === 'member' || role === 'admin', isAdmin: role === 'admin' };
  const parts = route.split('?')[0].split('/').filter(Boolean);
  const section = parts[0] ?? '';

  let view;
  if (!section) view = html`<${Dashboard} me=${me} />`;
  else if (section === 'items' && !parts[1]) view = html`<${Items} me=${me} />`;
  else if (section === 'items' && parts[1] === 'new') view = html`<${ItemForm} me=${me} key=${route} />`;
  else if (section === 'items' && parts[2] === 'edit') view = html`<${ItemForm} me=${me} id=${parts[1]} key=${parts[1]} />`;
  else if (section === 'items') view = html`<${ItemDetail} me=${me} id=${parts[1]} key=${parts[1]} />`;
  else if (section === 'locations' && !parts[1]) view = html`<${Locations} me=${me} />`;
  else if (section === 'locations') view = html`<${Items} me=${me} locationId=${parts[1]} key=${parts[1]} />`;
  else if (section === 'labels' && parts[1] === 'item') view = html`<${Labels} preselect=${parts[2]} key=${parts[2]} />`;
  else if (section === 'labels' && parts[1] === 'locations') view = html`<${Labels} startMode="locations" key="loc" />`;
  else if (section === 'labels') view = html`<${Labels} key="items" />`;
  else if (section === 'projects' && !parts[1]) view = html`<${Projects} me=${me} />`;
  else if (section === 'projects') view = html`<${ProjectDetail} me=${me} id=${parts[1]} key=${parts[1]} />`;
  else if (section === 'suppliers') view = html`<${Suppliers} me=${me} />`;
  else if (section === 'import') view = html`<${ImportItems} me=${me} />`;
  else if (section === 'history') view = html`<${History} />`;
  else if (section === 'team' && me.isAdmin) view = html`<${Team} me=${me} workshop=${auth.current} onChange=${refresh} />`;
  else if (section === 'workshops') view = html`<${Workshops} workshops=${auth.workshops} current=${auth.current} onChange=${refresh} />`;
  else view = html`<p class="state">Page not found. <a href="#/"><u>Go to the dashboard</u></a></p>`;

  const navSection = ['locations', 'labels', 'suppliers', 'import'].includes(section) ? 'items' : section;
  const link = (href, label, key) =>
    html`<a href=${href} class=${navSection === key ? 'active' : ''}>${label}</a>`;

  return html`
    ${demoMode &&
    html`<div class="banner">
      <span>Demo mode: sample data, saved only in this browser. Connect Supabase to share with your team.</span>
      <button onClick=${() => { db.resetDemo(); toast('Sample data restored'); location.reload(); }}>Reset sample data</button>
    </div>`}
    <header class="topbar">
      <${Brand} name=${auth.current.name} />
      <nav class="nav">
        ${link('#/', 'Home', '')} ${link('#/items', 'Items', 'items')} ${link('#/projects', 'Projects', 'projects')}
        ${link('#/history', 'History', 'history')}
        ${me.isAdmin && link('#/team', 'Team', 'team')}
      </nav>
      <div class="user">
        <span class="who">${me.full_name || me.email}</span>
        <button class="btn small" onClick=${() => go('/workshops')}>Workshops</button>
        ${!demoMode && html`<button class="btn small" onClick=${() => db.signOut()}>Sign out</button>`}
      </div>
    </header>
    <main>${view}</main>
    <${Voice} me=${me} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));
