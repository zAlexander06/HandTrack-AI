const nome_dita = ["Pollice", "Indice", "Medio", "Anulare", "Mignolo"];

const connections = [
    [0, 1], [1, 2], [2, 3], [3, 4],
    [0, 5], [5, 6], [6, 7], [7, 8],
    [0, 9], [9, 10], [10, 11], [11, 12],
    [0, 13], [13, 14], [14, 15], [15, 16],
    [0, 17], [17, 18], [18, 19], [19, 20],
];

export function landmarks_canvas(canvas, ctx, landmarks, video) {
    const { scale, offsetX, offsetY } = window.get_cover_transform(video, canvas);

    ctx.strokeStyle = "#00C8FF";
    ctx.lineWidth = 2;

    connections.forEach(([a, b]) => {
        const pA = {
            x: landmarks[a].x * video.videoWidth * scale + offsetX,
            y: landmarks[a].y * video.videoHeight * scale + offsetY,
        };
        const pB = {
            x: landmarks[b].x * video.videoWidth * scale + offsetX,
            y: landmarks[b].y * video.videoHeight * scale + offsetY,
        };
        ctx.beginPath();
        ctx.moveTo(pA.x, pA.y);
        ctx.lineTo(pB.x, pB.y);
        ctx.stroke();
    });

    ctx.fillStyle = "#00FF00";
    landmarks.forEach(lm => {
        const p = {
            x: lm.x * video.videoWidth * scale + offsetX,
            y: lm.y * video.videoHeight * scale + offsetY,
        };
        ctx.beginPath();
        ctx.arc(p.x, p.y, 4, 0, 2 * Math.PI);
        ctx.fill();
    });
}

export function info_panel_canvas(ctx, info, x, y, titolo) {
    const w = 220, h = 160;

    ctx.fillStyle = "rgba(30,30,30,0.6)";
    ctx.fillRect(x, y, w, h);
    ctx.font = "bold 14px sans-serif";
    ctx.fillStyle = "#C8C8C8";
    ctx.fillText(titolo, x + 10, y + 25);
    ctx.font = "12px sans-serif";

    info.forEach((su, i) => {
        ctx.fillStyle = su ? "#00FF00" : "#FF2222";
        ctx.fillText(`${nome_dita[i]}: ${su ? "SU" : "GIU"}`, x + 10, y + 55 + i * 20);
    });
}

export function predizione_panel_canvas(canvas, ctx, lettera, confidenza, top3, ia_model) {
    const w = canvas.width, h = canvas.height;
    const pw = 320, ph = 220;
    const px = (w - pw) / 2 | 0;
    const py = h - ph - 10;

    ctx.fillStyle = "rgba(15,15,40,0.75)";
    ctx.fillRect(px, py, pw, ph);
    ctx.strokeStyle = "#3C3C78";
    ctx.lineWidth = 1;
    ctx.strokeRect(px, py, pw, ph);

    if (!lettera) {
        const msg = ia_model ? "Nessuna mano" : "Nessun modello AI";
        ctx.font = "14px sans-serif";
        ctx.fillStyle = "#787878";
        ctx.textAlign = "center";
        ctx.fillText(msg, px + pw / 2, py + ph / 2);
        ctx.textAlign = "left";
        return;
    }

    ctx.font = "bold 80px sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.fillText(lettera, px + pw / 2, py + 92);
    ctx.textAlign = "left";

    const bc_x = px + 20, bc_y = py + 107;
    const bc_w = pw - 40, bc_h = 18;
    ctx.fillStyle = "#323232";
    ctx.fillRect(bc_x, bc_y, bc_w, bc_h);

    const fill = bc_w * confidenza | 0;
    const r = (255 * (1 - confidenza)) | 0;
    const g = (255 * confidenza) | 0;

    ctx.fillStyle = `rgb(0,${g},${r})`;
    ctx.fillRect(bc_x, bc_y, fill, bc_h);
    ctx.strokeStyle = "#646464";
    ctx.strokeRect(bc_x, bc_y, bc_w, bc_h);
    ctx.font = "12px sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";

    ctx.fillText(`${(confidenza * 100).toFixed(0)}%`, bc_x + bc_w / 2, bc_y + 13);
    ctx.textAlign = "left";

    (top3 || []).forEach(([lbl, prob], rank) => {
        ctx.font = rank === 0 ? "13px sans-serif" : "11px sans-serif";
        ctx.fillStyle = rank === 0 ? "#FFFFFF" : "#969696";
        ctx.fillText(
            `${rank + 1}. ${lbl}  ${(prob * 100).toFixed(0)}%`,
            px + 20, py + 147 + rank * 24
        );
    });
}

export function topbar_canvas(canvas, ctx, dita_tot, fps, status, cartella_dati, csv_counter, ia_model) {
    const w = canvas.width;

    ctx.fillStyle = "rgba(20,20,20,0.9)";
    ctx.fillRect(0, 0, w, 55);
    ctx.font = "bold 18px sans-serif";
    ctx.fillStyle = "#FFFFFF";
    ctx.fillText(`Dita: ${dita_tot}`, 20, 38);
    ctx.font = "16px sans-serif";
    ctx.fillStyle = "#64FF64";
    ctx.fillText(`FPS: ${fps | 0}`, w - 110, 38);

    const badge = ia_model ? "AI: attivo" : "AI: nessun modello";
    ctx.font = "11px sans-serif";
    ctx.fillStyle = ia_model ? "#00C8FF" : "#505050";
    ctx.fillText(badge, 20, 18);

    let info, color;
    if (status === "registrazione") {
        info = `⬤ REC -> ${cartella_dati || "—"}  |  CSV: ${csv_counter}`;
        color = "#FF5000";
    } else if (status === "conferma") {
        info = `[S] Avvia  |  [Esc] Annulla — ${cartella_dati}`;
        color = "#50C8FF";
    } else {
        info = "[S] Scegli cartella / Avvia registrazione";
        color = "#A0A0A0";
    }

    ctx.font = "11px sans-serif";
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.fillText(info, w / 2, 22);
    ctx.textAlign = "left";
}

export function conferma_overlay_canvas(canvas, ctx, cartella_dati, csv_counter) {
    const w = canvas.width, h = canvas.height;

    ctx.fillStyle = "rgba(10,30,10,0.55)";
    ctx.fillRect(0, 0, w, h);
    const lines = [
        { text: "Cartella selezionata:", color: "#B4B4B4", size: 16 },
        { text: cartella_dati || "—", color: "#50FF78", size: 22 },
        { text: `CSV presenti: ${csv_counter}`, color: "#B4B4B4", size: 15 },
        { text: "", color: "", size: 10 },
        { text: "[S]  Inizia registrazione", color: "#00DC64", size: 24 },
        { text: "[Esc]  Annulla", color: "#6464FF", size: 16 },
    ];

    let y = h / 2 - 80;
    lines.forEach(({ text, color, size }) => {
        if (!text) { y += 15; return; }
        ctx.font = `${size}px sans-serif`;
        ctx.fillStyle = color;
        ctx.textAlign = "center";
        ctx.fillText(text, w / 2, y);
        ctx.textAlign = "left";
        y += size * 2.2;
    });
}