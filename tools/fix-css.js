const fs = require('fs');
let css = fs.readFileSync('C:/Users/PC/Downloads/I.Need.to.Fix.My.Dream.Car/TikTokBridge/public/dashboard/style.css', 'utf8');

// The corrupted text has spaces between characters, we'll just slice it out safely.
// We know it starts around index 18900 to 19100. Let's find the `/* ─── Animations` and slice shortly after.
const animIndex = css.indexOf('/* ─── Animations ─────────────────────────────────────────── */');
let cleanCss = css.slice(0, animIndex + 500); // give some buffer

// Find the last actual closing brace before the corrupted text
const lastBrace = cleanCss.lastIndexOf('}');
cleanCss = cleanCss.slice(0, lastBrace + 1) + '\n\n';

const goodCss = `
/* %%% Gifts Data Grid %%% */
.gifts-header { padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 16px; }
.gifts-actions { display: flex; gap: 8px; align-items: center; }
.gifts-data-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 16px;
}
.gift-card {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 16px 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    transition: all 0.2s;
}
.gift-card:hover {
    border-color: var(--accent);
    transform: translateY(-2px);
}
.gift-image {
    width: 64px;
    height: 64px;
    object-fit: contain;
    margin-bottom: 12px;
}
.gift-name {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary);
    margin-bottom: 4px;
}
.gift-coins {
    font-size: 12px;
    color: var(--warning);
    font-weight: 500;
    margin-bottom: 4px;
}
.gift-id {
    font-size: 11px;
    color: var(--text-muted);
    font-family: var(--font-mono);
}
`;

fs.writeFileSync('C:/Users/PC/Downloads/I.Need.to.Fix.My.Dream.Car/TikTokBridge/public/dashboard/style.css', cleanCss + goodCss, 'utf8');
