const state = {
    cvReady: false,
    mode: 'single', // 'single', 'same-image', 'diff-image'
    direction: 'horizontal', // 'horizontal', 'vertical'
    images: {
        primary: { element: new Image(), loaded: false },
        secondary: { element: new Image(), loaded: false }
    },
    // The polygons for each mode
    polys: {
        single: {
            sam: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 200 }, { x: 100, y: 200 }]
        },
        same: {
            ref: [{ x: 100, y: 50 }, { x: 500, y: 50 }, { x: 500, y: 150 }, { x: 100, y: 150 }],
            sam: [{ x: 100, y: 200 }, { x: 500, y: 200 }, { x: 500, y: 300 }, { x: 100, y: 300 }]
        },
        diff: {
            ref: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 200 }, { x: 100, y: 200 }],
            sam: [{ x: 100, y: 100 }, { x: 500, y: 100 }, { x: 500, y: 200 }, { x: 100, y: 200 }]
        }
    },
    dragState: {
        active: false,
        polyKey: null, // 'ref' or 'sam'
        pointIndex: -1, // -1 means dragging whole, >=0 means corner
        startX: 0,
        startY: 0
    },
    calib: {
        active: false,
        p1: null, w1: 435.8,
        p2: null, w2: 546.1
    },
    pickMode: null, // "1", "2", or null
    chartScaleX: [], // currently displayed chart X values
    lastChartData: null // { type: 'intensity', samProfile: [], refProfile: [] }
};

let spectrumChart = null;

// Initialize when DOM and OpenCV are ready
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    initUI();
    initChart();
});

// Called when OpenCV script loads
function onOpenCvReady() {
    state.cvReady = true;
    document.getElementById('loading-overlay').classList.add('hidden');
    console.log("OpenCV.js Ready");
}

// Check openCV ready loop, since script async loads
const cvCheckInterval = setInterval(() => {
    if (typeof cv !== 'undefined' && cv.Mat) {
        clearInterval(cvCheckInterval);
        onOpenCvReady();
    }
}, 200);

function initTheme() {
    const themeBtn = document.getElementById('theme-btn');
    const toggleTheme = () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        themeBtn.textContent = newTheme === 'dark' ? '☀️' : '🌙';
        if (spectrumChart) {
            Chart.defaults.color = newTheme === 'dark' ? '#f1f5f9' : '#334155';
            spectrumChart.update();
        }
    };

    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
        themeBtn.textContent = '☀️';
    } else {
        themeBtn.textContent = '🌙';
    }
    themeBtn.addEventListener('click', toggleTheme);
}

function initUI() {
    const modeSelect = document.getElementById('mode-select');
    modeSelect.addEventListener('change', (e) => {
        state.mode = e.target.value;
        updateVisibility();
        redrawAll();
    });

    const directionSelect = document.getElementById('direction-select');
    if (directionSelect) {
        directionSelect.addEventListener('change', (e) => {
            let oldDirection = state.direction;
            state.direction = e.target.value;

            // Auto rotate polys to fit new direction if changed
            if (oldDirection !== state.direction) {
                for (let mode in state.polys) {
                    for (let key in state.polys[mode]) {
                        let poly = state.polys[mode][key];
                        // rotate 90 deg around center
                        let cx = (poly[0].x + poly[2].x) / 2;
                        let cy = (poly[0].y + poly[2].y) / 2;
                        for (let pt of poly) {
                            let dx = pt.x - cx;
                            let dy = pt.y - cy;
                            pt.x = cx - dy;
                            pt.y = cy + dx;
                        }
                    }
                }
            }
            redrawAll();
        });
    }

    setupDropZone('primary');
    setupDropZone('secondary');

    document.getElementById('extract-btn').addEventListener('click', processImages);
    document.getElementById('export-csv-btn').addEventListener('click', exportCSV);

    const canvasPrim = document.getElementById('preview-canvas-primary');
    const canvasSec = document.getElementById('preview-canvas-secondary');
    setupCanvasEvents(canvasPrim, 'primary');
    setupCanvasEvents(canvasSec, 'secondary');

    // Calibration Pick Mode
    document.querySelectorAll('.pick-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const target = e.target.dataset.target;
            if (state.pickMode === target) {
                // Toggle off
                state.pickMode = null;
                btn.classList.remove('active');
            } else {
                // Toggle on
                document.querySelectorAll('.pick-btn').forEach(b => b.classList.remove('active'));
                state.pickMode = target;
                btn.classList.add('active');
                alert(`校正点${target}をセットします。グラフ上で該当するピーク（Pixel）をクリックしてください。`);
            }
        });
    });

    document.getElementById('apply-calib-btn').addEventListener('click', applyCalibration);
    document.getElementById('reset-calib-btn').addEventListener('click', resetCalibration);
}

function updateVisibility() {
    const dropSec = document.getElementById('drop-zone-secondary');
    const canvasSec = document.getElementById('canvas-wrapper-secondary');
    const promptPrim = document.getElementById('primary-prompt');

    if (state.mode === 'single') {
        dropSec.classList.add('hidden');
        canvasSec.classList.add('hidden');
        promptPrim.textContent = "画像（スペクトル）を選択";
    } else if (state.mode === 'same-image') {
        dropSec.classList.add('hidden');
        canvasSec.classList.add('hidden');
        promptPrim.textContent = "画像（Ref & Sam を含む）を選択";
    } else if (state.mode === 'diff-image') {
        dropSec.classList.remove('hidden');
        canvasSec.classList.remove('hidden');
        promptPrim.textContent = "Reference画像を選択";
    }
}

function setupDropZone(targetId) { // 'primary' or 'secondary'
    const dropZone = document.getElementById(`drop-zone-${targetId}`);
    const fileInput = document.getElementById(`file-input-${targetId}`);

    dropZone.addEventListener('click', () => fileInput.click());

    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) {
            handleFile(e.dataTransfer.files[0], targetId);
        }
    });

    fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
            handleFile(e.target.files[0], targetId);
        }
    });
}

function handleFile(file, targetId) {
    if (!file) return;

    const isHeic = file.name.toLowerCase().endsWith('.heic') || file.name.toLowerCase().endsWith('.heif');
    if (!file.type.startsWith('image/') && !isHeic) return;

    const processBlob = (blob) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = state.images[targetId];
            img.element.onload = () => {
                img.loaded = true;

                // Adjust polygon sizes based on image size roughly
                const w = img.element.width;
                const h = img.element.height;
                const cx = w / 2;
                const cy = h / 2;

                let spanX, spanY;
                if (state.direction === 'horizontal') {
                    spanX = Math.min(400, w * 0.4);
                    spanY = Math.min(100, h * 0.1);
                } else {
                    spanX = Math.min(100, w * 0.1);
                    spanY = Math.min(400, h * 0.4);
                }

                // Re-center poly if first time loaded
                if (targetId === 'primary') {
                    if (state.mode === 'single') {
                        setPoly('single', 'sam', cx - spanX, cy - spanY, cx + spanX, cy + spanY);
                    } else {
                        setPoly('same', 'ref', cx - spanX, cy - spanY * 2 - 20, cx + spanX, cy - 20);
                        setPoly('same', 'sam', cx - spanX, cy + 20, cx + spanX, cy + spanY * 2 + 20);
                    }
                    setPoly('diff', 'ref', cx - spanX, cy - spanY, cx + spanX, cy + spanY);
                } else if (targetId === 'secondary') {
                    setPoly('diff', 'sam', cx - spanX, cy - spanY, cx + spanX, cy + spanY);
                }

                document.getElementById('extract-btn').disabled = false;
                redrawAll();
            };
            img.element.src = e.target.result;
        };
        reader.readAsDataURL(blob);
    };

    if (isHeic) {
        // Overlay HEIC loading
        const overlay = document.getElementById('loading-overlay');
        const overlayText = overlay.querySelector('p');
        overlayText.textContent = 'HEIC画像を変換中...';
        overlay.classList.remove('hidden');

        heic2any({
            blob: file,
            toType: "image/jpeg",
            quality: 0.8
        })
            .then((conversionResult) => {
                let blob = Array.isArray(conversionResult) ? conversionResult[0] : conversionResult;
                overlay.classList.add('hidden');
                processBlob(blob);
            })
            .catch((e) => {
                console.error(e);
                alert('HEIC画像の変換に失敗しました。');
                overlay.classList.add('hidden');
            });
    } else {
        processBlob(file);
    }
}

function setPoly(mode, key, x1, y1, x2, y2) {
    state.polys[mode][key] = [
        { x: x1, y: y1 },
        { x: x2, y: y1 },
        { x: x2, y: y2 },
        { x: x1, y: y2 }
    ];
}

function getRoisForCurrentMode(canvasId) {
    // returns { key: polyArray, label: 'text', color: 'color' } list
    let list = [];
    if (state.mode === 'single' && canvasId === 'primary') {
        list.push({ key: 'sam', points: state.polys.single.sam, label: '解析範囲', color: 'lime' });
    } else if (state.mode === 'same-image' && canvasId === 'primary') {
        list.push({ key: 'ref', points: state.polys.same.ref, label: 'Reference (Ref)', color: 'blue' });
        list.push({ key: 'sam', points: state.polys.same.sam, label: 'Sample (Sam)', color: 'lime' });
    } else if (state.mode === 'diff-image') {
        if (canvasId === 'primary') {
            list.push({ key: 'ref', points: state.polys.diff.ref, label: 'Reference (Ref)', color: 'blue' });
        } else if (canvasId === 'secondary') {
            list.push({ key: 'sam', points: state.polys.diff.sam, label: 'Sample (Sam)', color: 'lime' });
        }
    }
    return list;
}

function setupCanvasEvents(canvas, targetId) {
    let activePolys = [];

    const getMousePos = (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY
        };
    };

    const dist = (p1, p2) => Math.hypot(p1.x - p2.x, p1.y - p2.y);

    const isInside = (pt, poly) => {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            let xi = poly[i].x, yi = poly[i].y;
            let xj = poly[j].x, yj = poly[j].y;
            let intersect = ((yi > pt.y) !== (yj > pt.y)) && (pt.x < (xj - xi) * (pt.y - yi) / (yj - yi) + xi);
            if (intersect) inside = !inside;
        }
        return inside;
    };

    const handleDown = (e) => {
        if (!state.images[targetId].loaded) return;

        if (e.type === 'touchstart') {
            e.preventDefault();
        }

        let clientX = e.clientX;
        let clientY = e.clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }

        const m = getMousePos({ clientX, clientY });
        activePolys = getRoisForCurrentMode(targetId);

        for (let ap of activePolys) {
            let poly = ap.points;
            // Check points first
            for (let i = 0; i < poly.length; i++) {
                if (dist(m, poly[i]) < 25) { // increased hit radius heavily for touch
                    state.dragState = { active: targetId, polyKey: ap.key, pointIndex: i, startX: m.x, startY: m.y };
                    return;
                }
            }
            // Check inside
            if (isInside(m, poly)) {
                state.dragState = { active: targetId, polyKey: ap.key, pointIndex: -1, startX: m.x, startY: m.y };
                return;
            }
        }
    };

    const handleMove = (e) => {
        if (state.dragState.active !== targetId) return;
        e.preventDefault(); // prevent scrolling while dragging

        let clientX = e.clientX;
        let clientY = e.clientY;
        if (e.touches && e.touches.length > 0) {
            clientX = e.touches[0].clientX;
            clientY = e.touches[0].clientY;
        }

        const m = getMousePos({ clientX, clientY });
        let modePolys = state.polys[state.mode];
        if (!modePolys) return;
        let poly = modePolys[state.dragState.polyKey];
        if (!poly) return;

        let dx = m.x - state.dragState.startX;
        let dy = m.y - state.dragState.startY;

        if (state.dragState.pointIndex >= 0) {
            poly[state.dragState.pointIndex].x += dx;
            poly[state.dragState.pointIndex].y += dy;
        } else {
            for (let p of poly) {
                p.x += dx; p.y += dy;
            }
        }

        state.dragState.startX = m.x;
        state.dragState.startY = m.y;
        redrawAll();
    };

    const stopDrag = () => {
        state.dragState.active = false;
    };

    canvas.addEventListener('pointerdown', handleDown);
    canvas.addEventListener('pointermove', handleMove);
    canvas.addEventListener('touchstart', handleDown, { passive: false });
    canvas.addEventListener('touchmove', handleMove, { passive: false });

    window.addEventListener('pointerup', stopDrag);
    window.addEventListener('touchend', stopDrag);

}

function redrawAll() {
    drawCanvas('primary');
    drawCanvas('secondary');
}

function drawCanvas(targetId) { // 'primary' or 'secondary'
    const imgData = state.images[targetId];
    const canvas = document.getElementById(`preview-canvas-${targetId}`);
    if (!imgData.loaded) return;

    canvas.width = imgData.element.width;
    canvas.height = imgData.element.height;

    const ctx = canvas.getContext('2d');
    ctx.drawImage(imgData.element, 0, 0);

    const activePolys = getRoisForCurrentMode(targetId);

    for (let ap of activePolys) {
        let poly = ap.points;
        ctx.beginPath();
        ctx.moveTo(poly[0].x, poly[0].y);
        for (let i = 1; i < poly.length; i++) {
            ctx.lineTo(poly[i].x, poly[i].y);
        }
        ctx.closePath();
        ctx.strokeStyle = ap.color;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fill();

        ctx.fillStyle = ap.color;
        ctx.font = '24px Inter';
        ctx.fillText(ap.label, poly[0].x, poly[0].y - 10);

        // Draw Handles
        for (let pt of poly) {
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 12, 0, Math.PI * 2); // Increased visual size of the handles
            ctx.fillStyle = 'white';
            ctx.fill();
            ctx.strokeStyle = ap.color;
            ctx.lineWidth = 3;
            ctx.stroke();
            // Add an inner dot for precision feel
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
            ctx.fillStyle = ap.color;
            ctx.fill();
        }
    }
}

// Chart.js init
function initChart() {
    const ctx = document.getElementById('spectrum-chart').getContext('2d');
    Chart.defaults.color = document.documentElement.getAttribute('data-theme') === 'dark' ? '#f1f5f9' : '#334155';
    Chart.defaults.font.family = 'Inter';

    spectrumChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: [],
            datasets: []
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            elements: {
                point: { radius: 1, hitRadius: 30, hoverRadius: 5 } // Increased hit radius for mobile touch selection
            },
            interaction: { mode: 'index', intersect: false },
            scales: {
                x: {
                    title: { display: true, text: 'Pixel' }
                },
                y: {
                    title: { display: true, text: 'Intensity / Absorbance' }
                }
            },
            onClick: (e) => {
                if (state.pickMode) {
                    const elements = spectrumChart.getElementsAtEventForMode(e, 'nearest', { intersect: false }, false);
                    if (elements.length > 0) {
                        const index = elements[0].index;
                        const pixel = state.lastChartData.pixelOriginal[index];
                        document.getElementById(`calib-p${state.pickMode}`).value = pixel.toFixed(1);
                        state.calib[`p${state.pickMode}`] = pixel;

                        // Disable pick mode
                        document.querySelector(`.pick-btn[data-target="${state.pickMode}"]`).classList.remove('active');
                        state.pickMode = null;
                        spectrumChart.update();
                    }
                }
            },
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false
                }
            }
        }
    });
}

function processImages() {
    if (!state.cvReady) return alert("OpenCVがまだロードされていません。");

    if (state.mode === 'single' && state.images.primary.loaded) {
        let profile = extractProfile(state.images.primary.element, state.polys.single.sam);
        updateChart('intensity', { samProfile: profile });
    } else if (state.mode === 'same-image' && state.images.primary.loaded) {
        let refProfile = extractProfile(state.images.primary.element, state.polys.same.ref);
        let samProfile = extractProfile(state.images.primary.element, state.polys.same.sam);
        updateChart('absorbance', { refProfile, samProfile });
    } else if (state.mode === 'diff-image' && state.images.primary.loaded && state.images.secondary.loaded) {
        let refProfile = extractProfile(state.images.primary.element, state.polys.diff.ref);
        let samProfile = extractProfile(state.images.secondary.element, state.polys.diff.sam);
        updateChart('absorbance', { refProfile, samProfile });
    } else {
        alert("必要な画像がアップロードされていません。");
    }
}

function extractProfile(imgElement, poly) {
    let src = cv.imread(imgElement);
    let TL = poly[0], TR = poly[1], BR = poly[2], BL = poly[3];

    let widthA = Math.hypot(BR.x - BL.x, BR.y - BL.y);
    let widthB = Math.hypot(TR.x - TL.x, TR.y - TL.y);
    let maxWidth = Math.floor(Math.max(widthA, widthB));

    let heightA = Math.hypot(TR.x - BR.x, TR.y - BR.y);
    let heightB = Math.hypot(TL.x - BL.x, TL.y - BL.y);
    let maxHeight = Math.floor(Math.max(heightA, heightB));

    let dstPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
        0, 0,
        maxWidth - 1, 0,
        maxWidth - 1, maxHeight - 1,
        0, maxHeight - 1
    ]);
    let srcPoints = cv.matFromArray(4, 1, cv.CV_32FC2, [
        TL.x, TL.y,
        TR.x, TR.y,
        BR.x, BR.y,
        BL.x, BL.y
    ]);

    let M = cv.getPerspectiveTransform(srcPoints, dstPoints);
    let dst = new cv.Mat();
    let dsize = new cv.Size(maxWidth, maxHeight);
    cv.warpPerspective(src, dst, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

    let gray = new cv.Mat();
    cv.cvtColor(dst, gray, cv.COLOR_RGBA2GRAY);

    let profile;
    if (state.direction === 'horizontal') {
        profile = new Float32Array(maxWidth);
        for (let x = 0; x < maxWidth; x++) {
            let sum = 0;
            for (let y = 0; y < maxHeight; y++) {
                sum += gray.ucharPtr(y, x)[0];
            }
            profile[x] = sum / maxHeight;
        }
    } else {
        // Vertical processing: wave runs top to bottom
        profile = new Float32Array(maxHeight);
        for (let y = 0; y < maxHeight; y++) {
            let sum = 0;
            for (let x = 0; x < maxWidth; x++) {
                sum += gray.ucharPtr(y, x)[0];
            }
            profile[y] = sum / maxWidth;
        }
    }

    src.delete(); dstPoints.delete(); srcPoints.delete(); M.delete(); dst.delete(); gray.delete();
    return profile;
}

function updateChart(type, data) {
    let maxWidth = 0;
    if (data.samProfile) maxWidth = Math.max(maxWidth, data.samProfile.length);
    if (data.refProfile) maxWidth = Math.max(maxWidth, data.refProfile.length);

    let labels = [];
    let pixels = [];
    for (let i = 0; i < maxWidth; i++) {
        pixels.push(i);
        labels.push(i.toString());
    }

    state.lastChartData = {
        type: type,
        samProfile: Array.from(data.samProfile || []),
        refProfile: Array.from(data.refProfile || []),
        pixelOriginal: pixels
    };

    let datasets = [];

    if (type === 'intensity') {
        datasets.push({
            label: '強度 (Intensity)',
            data: state.lastChartData.samProfile,
            borderColor: '#3b82f6',
            backgroundColor: 'rgba(59, 130, 246, 0.1)',
            fill: true,
            borderWidth: 2,
            tension: 0.1
        });
        spectrumChart.options.scales.y.title.text = 'Intensity (0 - 255)';
    } else if (type === 'absorbance') {
        // Calculate Absorbance A = -log10(Sam / Ref)
        // Ensure strictly matched valid range
        let len = Math.min(state.lastChartData.samProfile.length, state.lastChartData.refProfile.length);
        let absProfile = [];
        for (let i = 0; i < len; i++) {
            let It = state.lastChartData.samProfile[i];
            let I0 = state.lastChartData.refProfile[i];
            // Fix small/zero division
            if (I0 <= 0.1) I0 = 0.1;
            if (It <= 0.1) It = 0.1;
            let ratio = It / I0;
            let A = -Math.log10(ratio);
            absProfile.push(A);
        }

        // Trim labels to match length
        labels = labels.slice(0, len);
        state.lastChartData.pixelOriginal = pixels.slice(0, len);
        state.lastChartData.absProfile = absProfile;

        datasets.push({
            label: '吸光度 (Absorbance)',
            data: absProfile,
            borderColor: '#f59e0b',
            backgroundColor: 'rgba(245, 158, 11, 0.1)',
            fill: true,
            borderWidth: 2,
            tension: 0.1
        });
        spectrumChart.options.scales.y.title.text = 'Absorbance (A)';
    }

    spectrumChart.data.labels = labels;
    spectrumChart.data.datasets = datasets;
    spectrumChart.options.scales.x.title.text = 'Pixel';

    // Apply calib if active
    if (state.calib.active) {
        applyCalibrationToChart();
    } else {
        spectrumChart.update();
    }

    document.getElementById('export-csv-btn').disabled = false;
}

function applyCalibration() {
    let p1 = parseFloat(document.getElementById('calib-p1').value);
    let p2 = parseFloat(document.getElementById('calib-p2').value);
    let w1 = parseFloat(document.getElementById('calib-w1').value);
    let w2 = parseFloat(document.getElementById('calib-w2').value);

    if (isNaN(p1) || isNaN(p2) || isNaN(w1) || isNaN(w2)) {
        return alert("必要な値が入力されていません。2点を画像から取得してください。");
    }
    if (p1 === p2) {
        return alert("2点が同一ピクセルになっています。");
    }

    state.calib.p1 = p1;
    state.calib.p2 = p2;
    state.calib.w1 = w1;
    state.calib.w2 = w2;
    state.calib.active = true;

    applyCalibrationToChart();
}

function resetCalibration() {
    state.calib.active = false;
    document.getElementById('calib-p1').value = '';
    document.getElementById('calib-p2').value = '';

    if (state.lastChartData) {
        let labels = state.lastChartData.pixelOriginal.map(p => p.toString());
        spectrumChart.data.labels = labels;
        spectrumChart.options.scales.x.title.text = 'Pixel';
        spectrumChart.update();
    }
}

function applyCalibrationToChart() {
    if (!state.lastChartData) return;

    let a = (state.calib.w2 - state.calib.w1) / (state.calib.p2 - state.calib.p1);
    let b = state.calib.w1 - a * state.calib.p1;

    let newLabels = state.lastChartData.pixelOriginal.map(p => {
        let w = a * p + b;
        return w.toFixed(1);
    });

    spectrumChart.data.labels = newLabels;
    spectrumChart.options.scales.x.title.text = 'Wavelength (nm)';
    spectrumChart.update();
}

function exportCSV() {
    if (!state.lastChartData) return;

    let data = state.lastChartData;
    let csv = [];

    let xHeaders = state.calib.active ? ["Wavelength_nm"] : ["Pixel"];

    if (data.type === 'intensity') {
        csv.push([...xHeaders, "Intensity"].join(','));
        for (let i = 0; i < data.pixelOriginal.length; i++) {
            let x = spectrumChart.data.labels[i];
            let y = data.samProfile[i];
            csv.push(`${x},${y}`);
        }
    } else {
        csv.push([...xHeaders, "Ref_Intensity", "Sam_Intensity", "Absorbance"].join(','));
        for (let i = 0; i < data.absProfile.length; i++) {
            let x = spectrumChart.data.labels[i];
            let refI = data.refProfile[i];
            let samI = data.samProfile[i];
            let absNum = data.absProfile[i];
            csv.push(`${x},${refI},${samI},${absNum}`);
        }
    }

    const blob = new Blob([csv.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spectrum_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}
