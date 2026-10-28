# EVEN · Block 0 belongs to everyone

Sajten för $EVEN: en anti-bundle-launchpad där alla som committar SOL köper block 0 till samma pris. En fil (`index.html`) med egen WebGL-motor (512 celler som morfar mellan bundlade skärvor och ett jämnt block), utan bibliotek och utan API-nycklar.

## Vad som är riktigt och vad som är larp

**Riktigt, live från Solana (inga nycklar):**
- **Gap Check**: klistra in valfri pump.fun-CA. Sajten hittar coinets första slot via publik RPC, läser varje köp i den, räknar block 0:s andel av supplyn, deras entry market cap, nuvarande market cap (DexScreener eller bonding curve) och hur mycket block 0-wallets fortfarande håller. Gör ett delningskort + text för X.
- **Bundle Index**: andelen pump.fun-launches där block 0 tog ≥ 20 % av supplyn. Byggs live i besökarens flik (pumpportal-strömmen + RPC) och från `data/index.json` som GitHub-jobbet fyller.
- **$EVEN:s eget block 0**: när `ca` är ifylld kör sidan Gap Check på $EVEN själv i token-sektionen.

**Larp, tydligt märkt "Simulated" / "Pilot":**
- Commit-fönstret och poolen i "How"-sekvensen.
- Avgiftsflödet (1 % av varje pool köper och bränner $EVEN).

## Fyll i vid launch

Överst i `<script>` i `index.html`, objektet `CONFIG`:

| Fält | Vad |
|---|---|
| `ca` | $EVEN:s mint. Tom = "Posted here and on X at launch" visas, köpknappar pekar på CA-rutan |
| `x` | Länk till X-profilen. Tom = X-ikonen döljs |
| `site` | Din domän, t.ex. `https://even.fun` (används i delningstexten) |
| `dexscreener` | Valfritt, annars används CA:ns DexScreener-sida |
| `rpc` | Publika RPC:er i ordning. `solana-rpc.publicnode.com` först, eftersom Solanas egen publika RPC nekar webbläsare (403) |
| `indexUrl` | Valfritt: raw-länk till `data/index.json` på GitHub för färskare index |

## Deploy

1. Lägg mappen i ett nytt GitHub-repo (hela mappen, inklusive `.github/`, `scripts/` och `data/`).
2. Vercel → New Project → importera repot → Framework: **Other**, ingen build, root = mappen.
3. GitHub → repot → **Actions** → "Bundle Index" → **Run workflow** en gång. Sedan körs det varannan timme av sig själv och skriver nya rader till `data/index.json`. Varje körning ger en ny Vercel-deploy (12 per dygn).
   - Gratis för publika repon. Privata repon har 2 000 gratisminuter i månaden; jobbet använder ungefär 1 500.

## Kolla efter deploy

- Heron: lampan vid Bundle Index ska gå från "Example" till **Live** inom några sekunder och räkna upp "Sampling live launches".
- Kör Gap Check på en coin från tavlan ("Check"-knappen). Resultatkortet ska visa "Live" och "Read from Solana · slot …".
- 3D-blocket: introt, sprängningen i "Slot 0 · today" och commit-sekvensen i "How".
- X-förhandsvisningen (`og.jpg`) när du klistrar in länken.

## Bra att veta

- Gap Check fungerar bäst på coins under ungefär ett dygn. På väldigt aktiva coins (över 6 000 transaktioner) stoppar den och säger det i stället för att gissa, eftersom en nyckelfri RPC inte kan bläddra längre bak.
- Publicnode har en gräns för hur många anrop man får göra. Om det blir trögt med mycket trafik: skaffa en gratis RPC-nyckel (t.ex. Helius) och lägg dess URL **först** i `CONFIG.rpc`.
- Pump.funs Mayhem-launches mintar en extra miljard tokens till ett separat konto. Sajten räknar andelar mot standard-supplyn på 1 miljard, som traders gör.
- `og.jpg` är 1200×630 och renderad från sajtens egen hero.
