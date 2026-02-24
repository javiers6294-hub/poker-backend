const express = require('express');
const cors = require('cors');
const { ClerkExpressRequireAuth } = require('@clerk/clerk-sdk-node');

const app = express();
app.use(express.json({ limit: '10mb' })); 
app.use(cors()); 

const hierarchy = ["STRAIGHT FLUSH","QUADS","FULL HOUSE","FLUSH","STRAIGHT","3 OF A KIND","TWO PAIR","OVERPAIR","TOP PAIR","TOP PAIR BAD K","MIDDLE PAIR","WEAK PAIR","FLUSH DRAW","OESD","GUTSHOT","ACE HIGH (kicker 9+)","ACE HIGH (kicker <9)","OVERCARDS","BACK DOOR FD","BACK DOOR SD","AIR / NOTHING"];

function getBestCategory(h, b) {
    if (!b.length) return "AIR / NOTHING";
    const hv=h.map(c=>c.v).sort((a,b)=>b-a), bv=b.map(c=>c.v).sort((a,b)=>b-a), all=[...h,...b];
    const vc={}, sc={}, bvc={}, bsc={}; 
    all.forEach(c=>{ vc[c.v]=(vc[c.v]||0)+1; sc[c.s]=(sc[c.s]||0)+1; });
    b.forEach(c=>{ bvc[c.v]=(bvc[c.v]||0)+1; bsc[c.s]=(bsc[c.s]||0)+1; });

    const isNewConnection = (val) => h.some(hc => hc.v === val) && (vc[val] > (bvc[val]||0));
    const isGoldSuit = (s) => h.some(hc => hc.s === s) && (sc[s] > (bsc[s]||0));

    const getS=(cards)=>{
        let t=[...new Set(cards.map(c=>c.v))]; if(t.includes(14)) t.push(1);
        t.sort((a,b)=>a-b); let m=1,c=1;
        for(let i=0;i<t.length-1;i++){if(t[i+1]-t[i]===1){c++;m=Math.max(m,c);}else c=1;} return {m,t};
    };
    const sI = getS(all), sB = getS(b);

    const tests = {
        "STRAIGHT FLUSH": () => Object.keys(sc).some(s => sc[s]>=5 && getS(all.filter(c=>c.s===s)).m>=5 && isGoldSuit(s)),
        "QUADS": () => hv.some(v => vc[v]===4 && isNewConnection(v)),
        "FULL HOUSE": () => {
            const trips = Object.keys(vc).filter(v => vc[v]===3);
            const pairs = Object.keys(vc).filter(v => vc[v]>=2);
            return trips.length && pairs.length >= 2 && h.some(hc => vc[hc.v] >= 2 && vc[hc.v] > (bvc[hc.v]||0));
        },
        "FLUSH": () => Object.keys(sc).some(s => sc[s]>=5 && isGoldSuit(s)),
        "STRAIGHT": () => {
            if(sI.m < 5 || sI.m <= sB.m) return false;
            for(let st=1; st<=10; st++){
                let seg = [st,st+1,st+2,st+3,st+4].map(v=>v===1?14:v);
                if(seg.every(v=>vc[v]) && h.some(hc=>seg.includes(hc.v))) return true;
            } return false;
        },
        "3 OF A KIND": () => hv.some(v => vc[v]===3 && isNewConnection(v)),
        "TWO PAIR": () => {
            const hits = hv.filter(v => bv.includes(v));
            return (hits.length >= 2) || (hv[0]===hv[1] && hits.length >= 1);
        },
        "OVERPAIR": () => hv[0]===hv[1] && hv[0] > bv[0],
        "TOP PAIR": () => hv.includes(bv[0]) && (hv[0]===bv[0]?hv[1]:hv[0]) >= 10,
        "TOP PAIR BAD K": () => hv.includes(bv[0]) && (hv[0]===bv[0]?hv[1]:hv[0]) < 10,
        "MIDDLE PAIR": () => hv.includes(bv[1]) || (hv[0]===hv[1] && hv[0]<bv[0] && hv[0]>bv[1]),
        "WEAK PAIR": () => hv.some(v=>bv.includes(v)) || hv[0]===hv[1],
        "FLUSH DRAW": () => b.length<5 && Object.keys(sc).some(s=>sc[s]===4 && isGoldSuit(s)),
        "OESD": () => b.length<5 && sI.m===4 && sI.m > sB.m && h.some(hc => sI.t.includes(hc.v) && !bv.includes(hc.v)),
        "GUTSHOT": () => {
            if(b.length>=5 || sI.m>=4) return false;
            for(let v=2; v<=14; v++) { if(!vc[v] && getS([...all,{v,s:'x'}]).m>=5 && h.some(hc => Math.abs(hc.v-v)<=2)) return true; }
            return false;
        },
        "ACE HIGH (kicker 9+)": () => hv[0]===14 && hv[1]>=9,
        "ACE HIGH (kicker <9)": () => hv[0]===14,
        "OVERCARDS": () => hv[0]>bv[0] && hv[1]>bv[0],
        "BACK DOOR FD": () => b.length===3 && Object.keys(sc).some(s => sc[s]===3 && isGoldSuit(s)),
        "BACK DOOR SD": () => b.length===3 && sI.m===3 && sI.m > sB.m && h.some(hc => sI.t.includes(hc.v) && !bv.includes(hc.v)),
        "AIR / NOTHING": () => true
    };

    for(let cat of hierarchy) if(tests[cat] && tests[cat]()) return cat;
    return "AIR / NOTHING";
}

app.post('/api/analyze', ClerkExpressRequireAuth(), (req, res) => {
    const { playerCombos, board } = req.body;
    let stats = { j1:{c:{}, t:0}, j2:{c:{}, t:0} };
    hierarchy.forEach(h => { stats.j1.c[h]=0; stats.j2.c[h]=0; });

    ['j1','j2'].forEach(p => {
        for(let id in playerCombos[p]) {
            playerCombos[p][id].forEach(combo => {
                if(!combo.some(hc=>board.some(bc=>bc.v===hc.v && bc.s===hc.s))) {
                    const cat = getBestCategory(combo, board);
                    stats[p].c[cat]++; stats[p].t++;
                }
            });
        }
    });
    res.json(stats);
});

app.post('/api/filter', ClerkExpressRequireAuth(), (req, res) => {
    const { playerCombos, board, f1, f2 } = req.body;
    let filteredCombos = JSON.parse(JSON.stringify(playerCombos));

    const pr = (p, f) => { 
        if(!f.length) return; 
        for(let id in filteredCombos[p]){ 
            filteredCombos[p][id] = filteredCombos[p][id].filter(c => f.includes(getBestCategory(c, board))); 
            if(!filteredCombos[p][id].length) delete filteredCombos[p][id]; 
        }
    };

    pr('j1', f1); 
    pr('j2', f2);
    res.json(filteredCombos);
});

// Manejo de errores si alguien intenta entrar sin sesión
app.use((err, req, res, next) => {
    if (err.message === 'Unauthenticated') {
        return res.status(401).json({ error: 'Acceso denegado. Inicia sesión.' });
    }
    next(err);
});

module.exports = app;
