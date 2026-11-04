// A small app for lantern's tests: everything an agent meets in a real one. Login with a cookie, a form with
// every kind of control, a popup link, dialogs, a file upload, slow content, a long page, a hash-routed page,
// an iframe, console errors and failed requests, a page that asks before unloading.
import http from 'node:http'

const page = (title: string, body: string, head = '') => `<!doctype html><meta charset="utf-8"><title>${title}</title>
<style>body{font:16px -apple-system,system-ui;margin:0;background:#f6f7f8;color:#15191c} header{background:#1f6f3f;color:#fff;padding:16px 24px;font-weight:700} main{padding:24px;max-width:720px} .card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1);margin-bottom:16px} button{background:#1f6f3f;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-weight:600;cursor:pointer} input,select,textarea{padding:8px 10px;border:1px solid #cbd;border-radius:8px;font:inherit} .row{display:flex;gap:12px;align-items:center;margin:8px 0;flex-wrap:wrap} #result{font-size:28px;font-weight:800;color:#1f6f3f} nav a{margin-right:12px}</style>
${head}<header>Trail planner</header><nav style="padding:8px 24px"><a href="/">Home</a><a href="/login">Login</a><a href="/secret">Secret</a><a href="/upload">Upload</a><a href="/slow">Slow</a><a href="/long">Long</a><a href="/spa">SPA</a><a href="/frame">Iframe</a><a href="/errors">Errors</a><a href="/unload">Unload</a><a href="/about" target="_blank" id="newtab">About (new tab)</a></nav><main>${body}</main>`

const routes: Record<string, (req: http.IncomingMessage, res: http.ServerResponse, body: string) => void> = {
  '/': (_q, res) => res.end(page('Lantern fixture', `
    <div class="card"><h2>Walk</h2>
      <div class="row"><label>Name <input id="name" placeholder="Walk name"></label><label>Type <select id="type"><option>Forest</option><option>Coast</option><option>Mountain</option></select></label></div>
      <div class="row"><label><input type="checkbox" id="lamp"> Bring a lantern</label><label style="position:relative"><input type="checkbox" id="fancy" aria-label="Fancy option" style="position:absolute;opacity:0;width:20px;height:20px"><span style="display:inline-block;width:20px;height:20px;border:2px solid #1f6f3f;border-radius:4px;vertical-align:middle"></span> Fancy</label><label><input type="radio" name="floor" value="morning" id="morning"> Morning</label><label><input type="radio" name="floor" value="evening" id="evening"> Evening</label></div>
      <div class="row"><label>Notes <textarea id="notes" rows="2"></textarea></label><div id="editor" contenteditable="true" style="border:1px solid #cbd;border-radius:8px;padding:8px;min-width:200px">edit me</div></div>
      <div class="row"><div id="dd" role="combobox" aria-label="Terrain" aria-expanded="false" style="border:1px solid #cbd;border-radius:8px;padding:8px;cursor:pointer">Path</div><ul id="ddlist" role="listbox" hidden style="list-style:none;margin:0;padding:4px;background:#fff;border:1px solid #cbd;border-radius:8px"><li role="option" style="padding:6px;cursor:pointer">Path</li><li role="option" style="padding:6px;cursor:pointer">Scramble</li><li role="option" style="padding:6px;cursor:pointer">Boardwalk</li></ul></div>
      <div class="row"><button id="estimate">Estimate time</button><button id="alert">Alert</button><button id="confirm">Confirm</button><button id="open">Open popup</button><button id="disabled" disabled>Disabled</button><div id="divbtn" style="cursor:pointer;padding:8px;background:#dfe6e2;border-radius:8px">A clickable div</div></div>
    </div>
    <div class="card"><h2>Your walk</h2><div id="result">—</div><p id="note">Describe the walk and ask for an estimate.</p><div role="status" id="status"></div></div>
    <div class="card"><h2>Slider</h2><div id="track" style="position:relative;height:24px;background:#dfe6e2;border-radius:12px"><div id="knob" style="position:absolute;left:0;top:0;width:24px;height:24px;border-radius:12px;background:#1f6f3f;cursor:grab"></div></div><p>Knob at <span id="knobx">0</span>px</p></div>
    <div class="card" style="height:1400px">a long way down</div>
    <script>
      const $ = (s) => document.querySelector(s)
      $('#estimate').onclick = () => { const n = $('#name').value || 'the walk'; const t = $('#type').value; $('#result').textContent = (t === 'Mountain' ? 3.5 : 2.0).toFixed(1) + ' h'; $('#note').textContent = 'Time for ' + n + ' (' + t + ($('#lamp').checked ? ', with a lantern' : '') + ')'; $('#status').textContent = 'Estimated'; console.warn('estimated for ' + n) }
      $('#alert').onclick = () => { alert('An alert'); $('#status').textContent = 'Alert dismissed' }
      $('#confirm').onclick = () => { $('#status').textContent = confirm('Sure?') ? 'Confirmed' : 'Cancelled' }
      $('#open').onclick = () => window.open('/about', '_blank')
      $('#divbtn').onclick = () => { $('#status').textContent = 'Div clicked' }
      $('#dd').onclick = () => { const l = $('#ddlist'); l.hidden = !l.hidden; $('#dd').setAttribute('aria-expanded', String(!l.hidden)) }
      for (const li of document.querySelectorAll('#ddlist li')) li.onclick = () => { $('#dd').textContent = li.textContent; $('#ddlist').hidden = true; $('#dd').setAttribute('aria-expanded', 'false') }
      document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.metaKey) $('#status').textContent = 'cmd+Enter'; if (e.key === '=' && e.metaKey) $('#status').textContent = 'code ' + e.code })
      $('#name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#estimate').click() })
      const knob = $('#knob'); let drag = null
      knob.addEventListener('mousedown', (e) => { drag = e.clientX - knob.offsetLeft; e.preventDefault() })
      document.addEventListener('mousemove', (e) => { if (drag === null) return; const x = Math.max(0, Math.min($('#track').clientWidth - 24, e.clientX - drag)); knob.style.left = x + 'px'; $('#knobx').textContent = String(Math.round(x)) })
      document.addEventListener('mouseup', () => { drag = null })
    </script>`)),
  '/about': (_q, res) => res.end(page('About', `<h1>About page</h1><p>Opened at ${new Date().toISOString()}</p>`)),
  '/login': (req, res, body) => {
    if (req.method === 'POST') { const p = new URLSearchParams(body); if (p.get('email') === 'dev@example.com' && p.get('password') === 'secret') { res.writeHead(302, { 'Set-Cookie': 'session=ok; Path=/', Location: '/secret' }); return res.end() } return res.end(page('Login', `<p role="alert">Wrong email or password</p>${LOGIN}`)) }
    res.end(page('Login', LOGIN))
  },
  '/secret': (req, res) => { if (!/session=ok/.test(req.headers.cookie ?? '')) { res.writeHead(302, { Location: '/login' }); return res.end() } res.end(page('Secret', `<h1>Welcome, dev</h1><p>You are logged in.</p><button id="poke">Poke</button><p id="poked">not poked</p><script>document.getElementById('poke').onclick=()=>{document.getElementById('poked').textContent='poked'}</script>`)) },
  '/shadow': (_q, res) => res.end(page('Shadow', `<div class="card"><h2>Light</h2><my-widget></my-widget><p id="out">nothing yet</p></div><script>customElements.define('my-widget', class extends HTMLElement { constructor() { super(); const r = this.attachShadow({ mode: 'open' }); r.innerHTML = '<style>button{background:#1f6f3f;color:#fff;border:0;padding:8px 12px;border-radius:8px;cursor:pointer}</style><label>Shadow name <input id="sname" placeholder="In the shadow"></label> <button id="sbtn">Shadow button</button>'; r.getElementById('sbtn').onclick = () => { document.getElementById('out').textContent = 'shadow clicked: ' + r.getElementById('sname').value } } })</script>`)),
  '/overlay': (_q, res) => res.end(page('Overlay', `<div class="card"><button id="under" onclick="document.getElementById('o').textContent='button clicked'">Covered button</button><p id="o">nothing</p></div><div id="veil" style="position:fixed;inset:0;background:transparent" onclick="document.getElementById('o').textContent='overlay clicked'"></div>`)),
  '/dialog': (_q, res) => res.end(page('Dialog', `<div class="card"><button id="open">Open dialog</button><button id="behind">Behind</button></div><dialog id="dlg" aria-label="Confirm it"><p>Are you sure?</p><button id="yes">Yes, sure</button><button id="no">No</button></dialog><script>document.getElementById('open').onclick=()=>document.getElementById('dlg').showModal();document.getElementById('yes').onclick=()=>{document.getElementById('dlg').close();document.getElementById('open').textContent='Confirmed'}</script>`)),
  '/inputs': (_q, res) => res.end(page('Inputs', `<div class="card"><div class="row"><label>Date <input type="date" id="d"></label><label>Range <input type="range" id="r" min="0" max="100" value="50"></label><label>Colour <input type="color" id="c" value="#ff0000"></label></div><div class="row"><label>Fruit <select id="multi" multiple><option>Apple</option><option>Banana</option><option>Cherry</option></select></label></div><p id="vals"></p><script>for (const el of document.querySelectorAll('input,select')) el.addEventListener('change', () => { document.getElementById('vals').textContent = [...document.querySelectorAll('input,select')].map((e) => e.id + '=' + (e.multiple ? [...e.selectedOptions].map((o) => o.text).join('+') : e.value)).join(' ') })</script></div>`)),
  '/focus': (_q, res) => res.end(page('Focus', `<div class="card"><label>Victim <input id="victim"></label> <label>Thief <input id="thief"></label></div><script>setInterval(() => document.getElementById('thief').focus(), 10)</script>`)),
  '/hoverme': (_q, res) => res.end(page('Hover', `<style>#hv .tip{display:none}#hv:hover .tip{display:block}</style><div class="card"><div id="hv" style="padding:20px;background:#dfe6e2">Hover me<div class="tip">The tooltip</div></div></div>`)),
  '/download': (req, res) => { if (req.url?.includes('file')) { res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename="report.txt"' }); return res.end('the report') } res.end(page('Download', `<div class="card"><a href="/download?file=1" id="dl">Download the report</a></div>`)) },
  '/empty404': (_q, res) => { res.writeHead(404); res.end() },
  // Forms that navigate in different ways, to tell them apart.
  '/forms': (_q, res) => res.end(page('Forms', `<div class="card">
    <form method="post" action="/post-echo"><button id="post-echo">POST, no redirect</button></form>
    <form method="post" action="/post-redirect"><button id="post-redirect">POST then 302</button></form>
    <form method="post" action="/post-redirect-cookie"><button id="post-redirect-cookie">POST then 302 with a cookie</button></form>
    <form method="get" action="/about"><button id="get-form">GET form</button></form>
    <form method="post" action="/post-echo"><input id="enter-field" placeholder="press Enter here"></form>
    <a id="cookie-link" href="/secret" onclick="document.cookie='session=ok; Path=/'">link to /secret after setting the cookie</a>
  </div>`)),
  '/post-echo': (_q, res) => res.end(page('Posted', `<h1>Posted</h1><button id="poke">Poke</button><p id="poked">not poked</p><script>document.getElementById('poke').onclick=()=>{document.getElementById('poked').textContent='poked'}</script>`)),
  '/post-redirect': (_q, res) => { res.writeHead(302, { Location: '/post-echo' }); res.end() },
  '/post-redirect-cookie': (_q, res) => { res.writeHead(302, { 'Set-Cookie': 'other=1; Path=/', Location: '/post-echo' }); res.end() },
  '/upload': (_q, res) => res.end(page('Upload', `<div class="card"><label>Photo <input type="file" id="file"></label><button id="pick">Choose a file</button><p id="picked">nothing yet</p></div><script>const f=document.getElementById('file');f.onchange=()=>{document.getElementById('picked').textContent='picked '+[...f.files].map(x=>x.name).join(', ')};document.getElementById('pick').onclick=()=>f.click()</script>`)),
  '/slow': (_q, res) => res.end(page('Slow', `<div class="card"><p id="s">Loading…</p></div><script>setTimeout(()=>{document.getElementById('s').textContent='Finally loaded'},1500)</script>`)),
  '/moves': (_q, res) => res.end(page('Moves', `<div class="card" style="position:relative;height:120px"><button id="a" style="position:absolute;left:20px;top:20px">A</button><button id="b" style="position:absolute;left:700px;top:60px">B</button><p id="n" style="position:absolute;left:20px;top:80px">0</p></div><script>let n=0;addEventListener('mousemove',()=>{n++;document.getElementById('n').textContent=String(n)})</script>`)),
  '/mods': (_q, res) => res.end(page('Modifiers', `<div class="card"><button id="mod" onclick="document.getElementById('held').textContent=[e.shiftKey&&'shift',e.altKey&&'alt',e.ctrlKey&&'ctrl',e.metaKey&&'meta'].filter(Boolean).join('+')||'none'" onmousedown="window.e=event">Click me</button><p id="held">nothing yet</p></div>`)),
  '/smooth': (_q, res) => res.end(page('Smooth', `<div class="card"><p id="picked2">nothing picked</p></div><div id="drawer" style="height:360px;overflow:auto;scroll-behavior:smooth;border:1px solid #ccd;border-radius:8px;background:#fff">${Array.from({ length: 12 }, (_, i) => `<button style="display:block;width:92%;margin:12px auto;padding:0;border:1px solid #ddd;border-radius:8px;background:#fff;text-align:left" onclick="document.getElementById('picked2').textContent='Card ${i + 1}'"><div style="height:110px;background:#e6ece8;border-radius:8px 8px 0 0"></div><div style="padding:10px 14px"><b>Card ${i + 1}</b> · a product in the drawer</div></button>`).join('')}</div>`)),
  '/long': (_q, res) => res.end(page('Long', Array.from({ length: 40 }, (_, i) => `<div class="card"><h2>Section ${i + 1}</h2><p>${i === 39 ? 'The very bottom' : 'Lorem ipsum'}</p></div>`).join(''))),
  '/spa': (_q, res) => res.end(page('SPA', `<div class="card"><a href="#/one" id="one">One</a> <a href="#/two" id="two">Two</a><h2 id="view">Home view</h2></div><script>const r=()=>{document.getElementById('view').textContent=location.hash==='#/one'?'One view':location.hash==='#/two'?'Two view':'Home view'};addEventListener('hashchange',r);r()</script>`)),
  '/frame': (_q, res) => res.end(page('Iframe', `<div class="card"><p>Outside the frame</p><iframe src="/about" style="width:600px;height:200px"></iframe></div>`)),
  '/errors': (_q, res) => res.end(page('Errors', `<div class="card"><p>This page misbehaves</p></div><script>console.error('something broke'); fetch('/missing'); setTimeout(()=>{throw new Error('uncaught boom')},100)</script>`)),
  '/unload': (_q, res) => res.end(page('Unload', `<div class="card"><p>Unsaved changes</p></div><script>addEventListener('beforeunload',(e)=>{e.preventDefault();e.returnValue=''})</script>`)),
}
const LOGIN = `<div class="card"><form method="post" action="/login"><div class="row"><label>Email <input type="email" name="email" id="email"></label></div><div class="row"><label>Password <input type="password" name="password" id="password"></label></div><button type="submit">Log in</button></form></div>`

export function start(port = 0): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (d) => (body += d))
    req.on('end', () => {
      const url = new URL(req.url ?? '/', 'http://x')
      const h = routes[url.pathname]
      if (!h) { res.writeHead(404); return res.end('not found') }
      res.setHeader('Content-Type', 'text/html; charset=utf-8')
      h(req, res, body)
    })
  })
  return new Promise((r) => server.listen(port, '127.0.0.1', () => { const a = server.address() as { port: number }; r({ url: `http://127.0.0.1:${a.port}`, close: () => server.close() }) }))
}

if (process.argv[1] && process.argv[1].endsWith('server.ts') && process.argv.includes('--serve')) start(Number(process.argv[process.argv.indexOf('--serve') + 1] || 8765)).then(({ url }) => console.log(url))
