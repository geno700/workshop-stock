// App shell: login, navigation and routing.
import { html, render, useState, useEffect } from './lib.js';
import { db, demoMode } from './data.js';
import { config } from '../config.js';
import { toast } from './ui.js';
import { Dashboard, Items, ItemDetail, ItemForm } from './views-items.js';
import { History, Team } from './views-other.js';
import { Locations, Labels } from './views-places.js';
import { Projects, ProjectDetail, Suppliers, ImportItems } from './views-manage.js';
import { Voice } from './voice.js';

function useRoute() {
  const read = () => location.hash.slice(1) || '/';
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

function Brand() {
  return html`<a class="brand" href="#/"><span class="brand-mark"></span>${config.workshopName}</a>`;
}

function Login() {
  const [mode, setMode] = useState('in');
  const [f, setF] = useState({ email: '', password: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'in') await db.signIn(f.email.trim(), f.password);
      else {
        const res = await db.signUp(f.email.trim(), f.password, f.name.trim());
        if (res.needsConfirm) setNotice('Check your email and open the confirmation link, then sign in here.');
      }
    } catch (err) {
      setError(err.message);
    }
    setBusy(false);
  }

  return html`
    <div class="auth">
      <${Brand} />
      <form class="card pad form" onSubmit=${submit}>
        <h1>${mode === 'in' ? 'Sign in' : 'Create account'}</h1>
        ${notice && html`<p class="small">${notice}</p>`}
        ${error && html`<p class="error">${error}</p>`}
        ${mode === 'up' &&
        html`<label><span>Your name</span><input required value=${f.name} onInput=${set('name')} autocomplete="name" /></label>`}
        <label><span>Email</span><input type="email" required value=${f.email} onInput=${set('email')} autocomplete="email" /></label>
        <label>
          <span>Password</span>
          <input type="password" required minlength="6" value=${f.password} onInput=${set('password')}
            autocomplete=${mode === 'in' ? 'current-password' : 'new-password'} />
        </label>
        <button class="btn primary" disabled=${busy}>${mode === 'in' ? 'Sign in' : 'Create account'}</button>
      </form>
      <p class="switch">
        ${mode === 'in' ? 'New here? ' : 'Already have an account? '}
        <button type="button" onClick=${() => { setMode(mode === 'in' ? 'up' : 'in'); setError(''); setNotice(''); }}>
          ${mode === 'in' ? 'Create an account' : 'Sign in'}
        </button>
      </p>
    </div>
  `;
}

function Pending({ profile }) {
  return html`
    <div class="auth">
      <${Brand} />
      <div class="card pad form">
        <h1>Waiting for approval</h1>
        <p class="muted">
          Your account (${profile?.email}) has been created. An admin of this workshop needs to give you access
          before you can see the stock.
        </p>
        <div class="actions">
          <button class="btn" onClick=${() => location.reload()}>Check again</button>
          <button class="btn" onClick=${() => db.signOut()}>Sign out</button>
        </div>
      </div>
    </div>
  `;
}

function App() {
  const route = useRoute();
  const [auth, setAuth] = useState({ loading: true });

  async function refresh() {
    try {
      const user = await db.getUser();
      const profile = user ? await db.getProfile() : null;
      setAuth({ user, profile });
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

  const role = auth.profile?.role ?? 'pending';
  if (role === 'pending') return html`<${Pending} profile=${auth.profile} />`;

  const me = { ...auth.profile, canEdit: role === 'member' || role === 'admin', isAdmin: role === 'admin' };
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
  else if (section === 'team' && me.isAdmin) view = html`<${Team} me=${me} />`;
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
      <${Brand} />
      <nav class="nav">
        ${link('#/', 'Home', '')} ${link('#/items', 'Items', 'items')} ${link('#/projects', 'Projects', 'projects')}
        ${link('#/history', 'History', 'history')}
        ${me.isAdmin && link('#/team', 'Team', 'team')}
      </nav>
      <div class="user">
        <span class="who">${me.full_name || me.email}</span>
        ${!demoMode && html`<button class="btn small" onClick=${() => db.signOut()}>Sign out</button>`}
      </div>
    </header>
    <main>${view}</main>
    <${Voice} me=${me} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));
