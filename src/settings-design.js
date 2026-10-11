// Presentation layer for the existing Settings forms. Native details, labels
// and submit buttons keep keyboard behavior and section saves predictable.
export const SETTINGS_DESIGN_CSS = `
html.drpp-root{height:100%;overflow:clip}
body.drpp-shell{height:100dvh;display:flex;flex-direction:column;overflow:clip;background:#191a1c;color:#e4e5e7;font:14px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
.drpp-shell .drpp-header{flex:none;min-height:72px;padding:16px 28px;background:#202124;gap:16px}
.drpp-shell h1{font-size:19px;font-weight:650;letter-spacing:-.5px}
.drpp-heading{gap:14px}.drpp-heading #drpp-version{font-size:12px;color:#adb0b8}
.drpp-actions{gap:8px}.drpp-actions a,.drpp-shell .drpp-actions button{border:0;background:transparent;color:#c3c6cc;padding:7px 10px;font-size:13px}
.drpp-actions a:hover,.drpp-shell .drpp-actions button:hover{background:#303237;color:#fff}
.drpp-columns{height:auto;flex:1;min-height:0}
.drpp-config{width:64%;background:#202124}.drpp-logs{width:36%;background:#191a1c}
.drpp-shell .drpp-panel-heading{padding:16px 24px;gap:12px;min-height:67px;border-color:#383a3f}
.drpp-shell .drpp-panel-heading h2{font-size:15px;font-weight:600}
.drpp-config>.drpp-panel-heading>span:not(.drpp-divider){color:#adb0b8;font-size:12px}
.drpp-shell .drpp-panel-heading label{font-size:12px;color:#c3c6cc}
.drpp-divider{background:#3d3f44;height:20px}
.settings-nav{display:flex;gap:6px;padding:12px 24px;border-bottom:1px solid #383a3f;flex:none;overflow-x:auto}
.drpp-shell .settings-nav a{color:#b4b7bf;font-size:13px;padding:5px 9px;white-space:nowrap;text-decoration:none;border-radius:4px}
.drpp-shell .settings-nav a:hover,.drpp-shell .settings-nav a[aria-current=true]{background:#33363c;color:#f3f4f6}
.drpp-config-scroll{padding:24px;scroll-behavior:smooth;scroll-padding-top:16px}
.drpp-config .drpp-accordion{background:#24262a;border:1px solid #42454b;border-radius:6px;margin:0 0 12px;overflow:clip}
.drpp-config .drpp-accordion>summary{padding:17px 20px;font-size:14px;font-weight:600;gap:16px}
.drpp-config .drpp-accordion>summary:hover{background:#2b2d32}
.drpp-config .drpp-accordion[open]>summary{border-color:#42454b}
.section-copy{display:flex;flex-direction:column;gap:2px}.section-copy small{font-size:12px;font-weight:400;color:#adb0b8}
.drpp-config .drpp-accordion section{padding:20px}
.drpp-shell .row{gap:10px 16px;margin:0 0 18px;align-items:center}
.drpp-shell .row label[for]{min-width:155px;max-width:100%;color:#d4d6dc;font-size:13px}
.drpp-config .hint,.drpp-config legend,.drpp-config dt,.drpp-config output,.drpp-config .unit{color:#b4b7bf;font-size:12px;line-height:1.7}
.drpp-config .hint{margin-bottom:18px;max-width:70ch}
.drpp-shell input,.drpp-shell select,.drpp-shell button{max-width:100%}
.drpp-shell button,.drpp-shell select,.drpp-shell input[type=number],.drpp-shell input[type=search],.drpp-shell input[type=text],.drpp-shell input[type=url],.drpp-shell input[type=password],.drpp-shell input:not([type]){border-radius:4px;background:#202124;color:#e4e5e7;padding:8px 10px;font-size:13px}
.drpp-shell button{border-color:#696d77;font-weight:500;min-height:34px}
.drpp-shell button:not(:disabled):hover{background:#35383f}
.drpp-shell button[type=submit]{background:#1971c2;border-color:#398bd7;color:#fff;padding:8px 18px}
.drpp-shell button[type=submit]:not(:disabled):hover{background:#1864ab}
.drpp-shell input:not([type=checkbox]):not([type=range]),.drpp-shell select{border-color:#858990}
.drpp-shell input[type=checkbox]{accent-color:#78aef1;width:16px;height:16px;vertical-align:-3px;margin:0 7px 0 0;flex:none}
.drpp-shell input[type=range]{width:min(180px,100%);accent-color:#8ab4f8}
.drpp-shell select{min-width:150px}.drpp-shell input[type=url],.drpp-shell input[type=text],.drpp-shell input[type=password],.drpp-shell input:not([type]){width:300px}
.drpp-shell input[type=search]{width:100%}.drpp-shell input::placeholder{color:#a8a9ae}
.drpp-shell :focus-visible{outline:2px solid #8ab4f8;outline-offset:3px}
.drpp-config a{color:#8fc4ff}.drpp-shell .ok{color:#8fc4ff}.drpp-shell .bad{color:#ffbb82}.drpp-shell .warn{color:#e0d070}
.drpp-config .drpp-setup{width:100%;background:#2d2922;border-color:#8e795a;border-radius:6px;margin:0 0 20px}
.drpp-setup a{width:fit-content;min-width:120px}
.drpp-shell #scan-help{font-size:12px;color:#b4b7bf;line-height:1.7;margin:0 0 16px}
.drpp-shell #discovered-list li,.drpp-shell #servers-list li{padding:12px 0;gap:12px;border-color:#474a51}
.drpp-shell #manual-add{margin-bottom:0}.drpp-shell #manual-add>summary{font-size:13px;color:#8fc4ff}
.drpp-shell #manual-add[open]>summary{margin-bottom:16px}
.drpp-shell #services-section h3{font-size:14px;font-weight:600}.drpp-shell #services-section>p{font-size:13px;color:#b4b7bf}
.drpp-shell #services-section>div{padding-top:12px;border-color:#474a51}
.drpp-shell #card-form .preview{margin:0 0 22px;padding:24px 16px;display:flex;flex-direction:column;align-items:center;background:#191a1c;border:1px solid #474a51;border-radius:4px;min-height:180px}
.drpp-shell .preview-label{align-self:flex-start;text-transform:uppercase;letter-spacing:.09em;font-size:10px;color:#adb0b8;margin:0 0 20px}
.drpp-shell .preview img{max-width:100%;height:auto}.drpp-shell .preview .hint{margin:12px 0 0}
.card-style-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 20px}
.drpp-shell .card-style{padding:10px;text-align:left;display:flex;flex-direction:column;gap:8px;background:#202124;border:1px solid #696d77;min-width:0;border-radius:4px}
.drpp-shell .card-style[aria-pressed=true]{border:2px solid #8ab4f8;padding:9px;background:#283442}
.card-style img{display:block;width:100%;height:auto;aspect-ratio:280/140;object-fit:contain}
.card-style strong{font-size:12px;font-weight:600}.card-style small{color:#b4b7bf;font-size:11px;line-height:1.5;font-weight:400}
.drpp-shell .card-advanced{margin:20px 0;border-top:1px solid #474a51;padding-top:16px}
.drpp-shell .card-advanced>summary{color:#d4d6dc;font-size:13px;font-weight:500;margin-bottom:16px}
.drpp-shell .card-advanced[open]>summary{margin-bottom:22px}
.drpp-logs .drpp-panel-heading{padding:16px;align-content:flex-start;gap:10px}
.drpp-logs .drpp-panel-heading input{flex-basis:100%;order:4}.drpp-logs .drpp-panel-heading small{margin-left:auto}
.drpp-logs .drpp-divider{display:none}.drpp-logs .drpp-panel-heading label{font-size:11px}
.drpp-log-lines{font:12px/1.8 ui-monospace,SFMono-Regular,Consolas,monospace;padding:12px 0}
.drpp-log-line{border-left-width:2px;padding:2px 14px;background:transparent}.drpp-log-line .source{color:#b5bcc8}
#drpp-info{background:#24262a;border-color:#696d77;border-radius:6px}
@media(min-width:1500px){.drpp-config-scroll{padding:28px 40px}.drpp-config{width:62%}.drpp-logs{width:38%}}
@media(prefers-reduced-motion:reduce){.drpp-config-scroll{scroll-behavior:auto}}
@media(max-width:1100px){.drpp-config{width:66%}.drpp-logs{width:34%}.card-style-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.drpp-shell .drpp-panel-heading{padding:16px}.settings-nav{padding:12px 16px}.drpp-config-scroll{padding:16px}}
@media(max-width:900px){html.drpp-root{height:auto;overflow:auto}body.drpp-shell{height:auto;display:block;overflow:visible}.drpp-columns{height:auto;display:block}.drpp-config,.drpp-logs{width:100%}.drpp-config-scroll{max-height:none;overflow:visible}.drpp-shell .drpp-header{padding:16px}.drpp-logs{border-top:1px solid #474a51}.drpp-log-lines{min-height:220px;max-height:360px}.settings-nav{flex-wrap:wrap}.drpp-config>.drpp-panel-heading{flex-wrap:wrap}.drpp-header .drpp-divider{display:none}}
@media(max-width:520px){.drpp-config .drpp-accordion>summary,.drpp-config .drpp-accordion section{padding:16px}.drpp-shell .row label[for]{min-width:0;flex-basis:100%}.drpp-shell .row input:not([type=checkbox]):not([type=range]),.drpp-shell .row select{width:100%}.drpp-shell .drpp-heading{flex-wrap:wrap}.card-style-grid{gap:8px}.drpp-shell #card-form .preview{padding:20px 10px}}
`;
