// Client-side asset localizer
// Rewrites common external asset URLs to ./resource/<host>/<path> when available.
(function(){
  'use strict';
  const hostsToLocalize = ['static.wixstatic.com','static.parastorage.com','video.wixstatic.com','www.googletagmanager.com','maps.googleapis.com','static.wixpress.com'];

  function mapToLocal(url){
    try{
      if(!url || url.startsWith('data:') || url.startsWith('blob:')) return url;
      // We intentionally do not map to /trup here. Leave the URL unchanged.
      return url;
    }catch(e){ return url; }
  }

  function localizeDocument(doc){
    try{
      // images
      Array.from(doc.querySelectorAll('img')).forEach(img=>{
        tryReplaceElementSrc(img, 'src');
        tryReplaceElementSrc(img, 'data-src');
        replaceSrcsetAttribute(img, 'srcset');
        replaceSrcsetAttribute(img, 'data-srcset');
      });

      // source elements
      Array.from(doc.querySelectorAll('source')).forEach(s=>{
        tryReplaceElementSrc(s,'src'); tryReplaceElementSrc(s,'data-src'); replaceSrcsetAttribute(s,'srcset'); replaceSrcsetAttribute(s,'data-srcset');
      });

      // video poster
      Array.from(doc.querySelectorAll('video[poster]')).forEach(v=> tryReplaceElementSrc(v, 'poster'));

      // link hrefs (icons, favicons, stylesheets)
      Array.from(doc.querySelectorAll('link[href]')).forEach(l=>{
        try{
          const href = l.getAttribute('href') || '';
          const mapped = mapToLocal(href);
          if(mapped && mapped !== href) l.setAttribute('href', mapped);
        }catch(e){}
      });

      // meta images
      Array.from(doc.querySelectorAll('meta[property][content], meta[name][content]')).forEach(m=>{
        try{
          const v = m.getAttribute('content') || '';
          const mapped = mapToLocal(v);
          if(mapped && mapped !== v) m.setAttribute('content', mapped);
        }catch(e){}
      });

      // inline styles on elements (background-image)
      Array.from(doc.querySelectorAll('[style]')).forEach(el=>{
        try{
          const s = el.getAttribute('style') || '';
          const replaced = s.replace(/url\(([^)]+)\)/g, (m,p)=>{
            const unq = p.replace(/^['"]|['"]$/g, '').trim();
            const mapped = mapToLocal(unq);
            return mapped === unq ? `url(${p})` : `url(${mapped})`;
          });
          if(replaced !== s) el.setAttribute('style', replaced);
        }catch(e){}
      });

      // <style> tags
      Array.from(doc.querySelectorAll('style')).forEach(st=>{
        try{
          const t = st.textContent || '';
          const replaced = t.replace(/https?:\/\/+[^\s)'"]+/g, (u)=>{ try{ const mapped = mapToLocal(u); return mapped === u ? u : mapped; }catch(e){return u} });
          if(replaced !== t) st.textContent = replaced;
        }catch(e){}
      });

    }catch(e){ console && console.warn && console.warn('localizeDocument failed', e); }
  }

  // run once for the main document
  try{ localizeDocument(document); }catch(e){}

  // observe DOM changes and re-run localization on added nodes
    try{
    // mutation observer: watch for late-added elements and attributes
    const obs = new MutationObserver(muts=>{
      muts.forEach(m=>{
        if(m.addedNodes && m.addedNodes.length){
          m.addedNodes.forEach(node=>{
            if(node.nodeType === 1){ // element
              try{ localizeDocument(node); }catch(e){}
            }
          });
        }
        if(m.type === 'attributes' && m.target) try{ localizeDocument(m.target); }catch(e){}
      });
    });
    obs.observe(document, { childList:true, subtree:true, attributes:true });
    // keep observing longer (5 minutes) to catch late dynamic content, then disconnect
    setTimeout(()=>{ try{ obs.disconnect(); }catch(e){} }, 300000);
  }catch(e){}

  // --- Forced replacement pass -------------------------------------------------
  // This function aggressively replaces img src/srcset, inline background-images
  // and attempts to patch accessible stylesheet rules. It returns a small report.
  // Always use uploaded banner images from the server (max 20)
  async function getUploadFiles(){
    try{
      let files = [];
      try{ const resp = await fetch('/api/uploads/banner/list', { cache: 'no-store' }); if(resp && resp.ok){ const body = await resp.json(); files = Array.isArray(body.files) ? body.files : (body.files || []); } }catch(e){}
      files = (files||[]).slice(0,20);
      if(typeof window !== 'undefined') try{ window._localizer_uploads = files; }catch(e){}
      return files;
    }catch(e){ return []; }
  }

  async function forcedReplaceAll(){
    const report = { imgs:0, srcsets:0, styles:0, sheets:0, backgrounds:0, pseudos:0 };
    try{
      const uploadFiles = await getUploadFiles();
      const useFiles = uploadFiles && uploadFiles.length ? uploadFiles : [];
      let backgroundIndex = 0;
      // images — forcefully assign uploaded banner images (round-robin) when available
      let fileIndex = 0;
      Array.from(document.querySelectorAll('img')).forEach(img=>{
        try{
          if(useFiles && useFiles.length){
            const file = useFiles[fileIndex % useFiles.length]; fileIndex++;
            if(file){
              try{ img.setAttribute('src', file); }catch(e){}
              try{ img.setAttribute('data-src', file); }catch(e){}
              try{ img.setAttribute('srcset', file); }catch(e){}
              try{ img.setAttribute('data-srcset', file); }catch(e){}
              try{ img.removeAttribute('loading'); img.removeAttribute('data-lazy'); }catch(e){}
              try{ img.classList && ['lazy','lazyload','ls-lazy','lqip','blur-up'].forEach(c=> img.classList.remove(c)); }catch(e){}
              try{ if(img.style && /blur\(/.test(img.style.filter)) img.style.filter = 'none'; }catch(e){}
              report.imgs++;
            }
          } else {
            // fallback: map to local
            const curSrc = img.getAttribute('src') || '';
            const mappedSrc = mapToLocal(curSrc || '') || '';
            if(mappedSrc && mappedSrc !== curSrc){ img.setAttribute('src', mappedSrc); report.imgs++; }
          }
        }catch(e){}
      });

      // inline styles on elements (background-image)
      Array.from(document.querySelectorAll('[style]')).forEach(el=>{
        try{
          const s = el.getAttribute('style') || '';
          const replaced = s.replace(/url\(([^)]+)\)/g, (m,p)=>{
            const unq = p.replace(/^['"]|['"]$/g, '').trim();
            const mapped = mapToLocal(unq);
            return mapped === unq ? `url(${p})` : `url(${mapped})`;
          });
          if(replaced !== s){ el.setAttribute('style', replaced); report.styles++; }
        }catch(e){}
      });

      // <style> tags (inline CSS)
      Array.from(document.querySelectorAll('style')).forEach(st=>{
        try{
          const t = st.textContent || '';
          const replaced = t.replace(/https?:\/\/[^)'"\}\s]+/g, (u)=>{ try{ const mapped = mapToLocal(u); return mapped === u ? u : mapped; }catch(e){return u} });
          if(replaced !== t){ st.textContent = replaced; report.styles++; }
        }catch(e){}
      });

      // Attempt to patch accessible stylesheet rules and append overrides
      try{
        let overrideCss = '';
        for(const ss of Array.from(document.styleSheets||[])){
          try{
            const rules = ss.cssRules || ss.rules;
            if(!rules) continue;
            for(const r of Array.from(rules)){
              try{
                const css = r.cssText || '';
                if(/https?:\/\//.test(css) || /static\.wixstatic|parastorage|maps.googleapis/.test(css)){
                  const replaced = css.replace(/https?:\/\/[^)'"\}\s]+/g, (u)=>{ try{ const mapped = mapToLocal(u); return mapped === u ? u : mapped; }catch(e){return u} });
                  if(replaced !== css) overrideCss += replaced + '\n';
                }
              }catch(e){}
            }
          }catch(e){ /* skip cross-origin stylesheets */ }
        }
        if(overrideCss){
          const id = 'localizer-overrides';
          let el = document.getElementById(id);
          if(!el){ el = document.createElement('style'); el.id = id; document.head.appendChild(el); }
          el.textContent = (el.textContent || '') + '\n' + overrideCss;
          report.sheets = (overrideCss.match(/\}/g)||[]).length;
        }
      }catch(e){}

      // --- computed style backgrounds & pseudo-elements
      try{
        const maxElements = 2000; // safety limit
        const all = Array.from(document.querySelectorAll('*')).slice(0, maxElements);
        const pseudoStyles = [];
        all.forEach(el => {
          try{
            const cs = window.getComputedStyle ? getComputedStyle(el) : null;
            const bg = cs ? cs.backgroundImage || '' : '';
            if(bg && bg !== 'none' && /url\(/.test(bg)){
              // if the background image is a remote URL (starts with http and not our /trup or /uploads), replace it
              const m = bg.match(/url\(([^)]+)\)/);
              if(m && m[1]){
                const raw = m[1].replace(/^['\"]|['\"]$/g,'').trim();
                if(raw && (/^https?:\/\//.test(raw) && !raw.includes('/trup/') && !raw.includes('/uploads/'))){
                  if(useFiles.length){
                    const file = useFiles[backgroundIndex % useFiles.length]; backgroundIndex++;
                    try{ el.style.setProperty('background-image', `url(${file})`, 'important'); el.style.setProperty('background-size','cover','important'); el.style.setProperty('background-position','center','important'); report.backgrounds++; }catch(e){}
                  }
                }
              }
            }
            // check pseudo-elements ::before and ::after
            ['::before','::after'].forEach(pseudo => {
              try{
                const pcs = window.getComputedStyle ? getComputedStyle(el, pseudo) : null;
                const pbg = pcs ? pcs.backgroundImage || '' : '';
                if(pbg && pbg !== 'none' && /url\(/.test(pbg)){
                  const m2 = pbg.match(/url\(([^)]+)\)/);
                  if(m2 && m2[1]){
                    const raw2 = m2[1].replace(/^['\"]|['\"]$/g,'').trim();
                    if(raw2 && (/^https?:\/\//.test(raw2) && !raw2.includes('/trup/') && !raw2.includes('/uploads/'))){
                      // create a per-element override using a data-localizer-id and append a rule that targets the pseudo
                      try{
                        let lid = el.getAttribute('data-localizer-id');
                        if(!lid){ lid = 'lok' + Math.floor(Math.random()*1000000); el.setAttribute('data-localizer-id', lid); }
                        const idx = backgroundIndex % (useFiles.length || 1);
                        const file2 = useFiles.length ? useFiles[idx] : raw2;
                        backgroundIndex++;
                        pseudoStyles.push({ id: lid, pseudo: pseudo, url: file2 });
                        report.pseudos++;
                      }catch(e){}
                    }
                  }
                }
              }catch(e){}
            });
          }catch(e){}
        });
        if(pseudoStyles.length){
          try{
            let el = document.getElementById('localizer-pseudo-overrides');
            if(!el){ el = document.createElement('style'); el.id = 'localizer-pseudo-overrides'; document.head.appendChild(el); }
            const rules = pseudoStyles.map(s => `*[data-localizer-id="${s.id}"]${s.pseudo}{ background-image: url(${s.url}) !important; background-size: cover !important; background-position: center !important; }`).join('\n');
            el.textContent = (el.textContent || '') + '\n' + rules;
          }catch(e){}
        }
      }catch(e){}

    }catch(e){/*ignore*/}
    // debug log (helpful while testing)
    try{ console && console.log && console.log('localizer: forcedReplaceAll', report); }catch(e){}
    return report;
  }

  // periodically run forced pass for a short window to catch late loads
  try{
    const interval = setInterval(()=>{ try{ forcedReplaceAll(); }catch(e){} }, 1000);
    // stop periodic passes after 5 minutes (300000ms)
    setTimeout(()=>{ try{ clearInterval(interval); }catch(e){} }, 300000);
    // expose helper for manual testing in DevTools
    try{ if(typeof window !== 'undefined') window._localizer_forcedReplace = forcedReplaceAll; }catch(e){}
  }catch(e){}

    // Fallback: if images remain missing or still point to remote vendor hosts,
    // try filling them from uploaded banner images provided by the server.
    // This calls the server endpoint `/api/uploads/banner/list` which returns
    // an array of public URLs under `/uploads/ads/...`.
    async function fillImagesFromUploads(doc){
      try{
          // Prefer server-uploaded banners only
          let files = [];
          try{ const resp = await fetch('/api/uploads/banner/list', {cache: 'no-store'}); if(resp && resp.ok){ const body = await resp.json(); files = Array.isArray(body.files)? body.files : (body.files||[]); } }catch(e){}
          const maxFiles = (files || []).slice(0,20);
        if(!maxFiles || !maxFiles.length) return;
        const candidates = Array.from((doc || document).querySelectorAll('img'))
          .filter(img => {
            try{
              const s = img.getAttribute('src') || '';
              return !s || s.trim() === '' || /static\.wix(static)?\.com|static\.parastorage\.com|static\.wixstatic\.com/.test(s);
            }catch(e){ return false; }
          });
        if(!candidates.length) return;
        candidates.forEach((img, i) => {
          try{
            const file = maxFiles[i % maxFiles.length];
            if(!file) return;
            img.setAttribute('src', file);
            img.removeAttribute('loading'); img.removeAttribute('data-src'); img.removeAttribute('data-lazy');
            try{ img.classList && ['lazy','lazyload','ls-lazy','lqip','blur-up'].forEach(c=> img.classList.remove(c)); }catch(e){}
            try{ if(img.style && /blur\(/.test(img.style.filter)) img.style.filter = 'none'; }catch(e){}
          }catch(e){}
        });

        // Inject merged background CSS using the uploaded images (create a style block)
        try{
          const head = document.head || document.getElementsByTagName('head')[0];
          const cssId = 'uploads-merged-css';
          if(!document.getElementById(cssId)){
            const style = document.createElement('style'); style.id = cssId;
            const images = maxFiles.map(f => `url(${f})`).join(', ');
            style.textContent = `.merged-uploads{ background-image: ${images}; background-repeat: no-repeat; background-size: cover; background-position: center; }`;
            head.appendChild(style);
            if(maxFiles.length >= 1) document.body.classList.add('merged-uploads');
          }
        }catch(e){}
      }catch(e){}
    }

    // run once after a short delay so earlier localization runs first
    try{ setTimeout(()=> fillImagesFromUploads(document), 600); }catch(e){}

})();

(window._localizer_forcedReplace && window._localizer_forcedReplace()) || 'forcedReplace helper not present'

(function waitAndInjectGallery(){
  const intervalMs = 300;
  const maxWait = 5000; // wait up to 5s for uploads to populate
  let waited = 0;
  function tryInject(){
    const files = window._localizer_uploads || [];
    if(files && files.length){
      try{
        const container = document.createElement('div');
        container.style.cssText = 'position:relative;display:flex;flex-wrap:wrap;gap:6px;padding:8px;background:#fff;z-index:9999';
        files.forEach(f=>{
          const img = document.createElement('img');
          img.src = f;
          img.style.width = '120px';
          img.style.height = 'auto';
          img.style.objectFit = 'cover';
          img.style.border = '1px solid #ddd';
          container.appendChild(img);
        });
        try{ document.body.insertBefore(container, document.body.firstChild); }catch(e){}
        console.log('Injected gallery with', files.length, 'images');
      }catch(e){ console.warn('gallery injection failed', e); }
      return;
    }
    waited += intervalMs;
    if(waited < maxWait) setTimeout(tryInject, intervalMs);
    else console.log('localizer: no upload files found to inject gallery');
  }
  setTimeout(tryInject, 500);
})();
