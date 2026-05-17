let memory = {};
let pc = 0;
let isDebugMode = false;
let currentOutSpan = null;
let isRunning = false;
let pendingInputResolve = null;
let pendingInputField = null;

const editor = document.getElementById('editor');
const highlightView = document.getElementById('highlight-view');
const debugView = document.getElementById('debug-view');
const consoleElem = document.getElementById('console');
const memContent = document.getElementById('mem-content');

function printOut(msg) {
    if (!currentOutSpan) {
        currentOutSpan = document.createElement('span');
        currentOutSpan.style.color = "#f1fa8c";
        consoleElem.appendChild(currentOutSpan);
    }
    currentOutSpan.innerText += msg;
    consoleElem.scrollTop = consoleElem.scrollHeight;
}

function log(msg, color="#50fa7b") {
    currentOutSpan = null;
    const div = document.createElement('div');
    div.style.color = color;
    div.innerText = msg;
    consoleElem.appendChild(div);
    consoleElem.scrollTop = consoleElem.scrollHeight;
}

// --- 주소 해결기 ---
// [변경] 이제 memStr 대신 토큰 배열을 직접 받음
// getVal()과 구조를 맞추기 위해 토큰 배열 기반으로 재설계
// 거+ 앞의 수식을 getValFromTokens()로 계산해서 주소로 사용
function resolveAddrFromTokens(tokens) {
    // 마지막 연속된 거 토큰들을 분리
    // 예) [수식토큰들..., {거}, {거}] → 수식부분 + geoCount=2
    let geoCount = 0;
    let i = tokens.length - 1;
    while (i >= 0 && tokens[i].type === 'geo') {
        geoCount++;
        i--;
    }
    const exprTokens = tokens.slice(0, i + 1); // 거 앞의 수식 토큰들

    let addr;
    if (exprTokens.length === 0) {
        // 거만 있는 경우: 주소 0에서 시작
        addr = 0;
    } else if (exprTokens.length === 1 && exprTokens[0].type === 'num') {
        // 순수 그+ 만 있는 경우: 그 개수가 주소
        addr = exprTokens[0].val.length;
    } else {
        // 수식이 있는 경우: getVal로 계산
        addr = getValFromTokens(exprTokens);
    }

    // 거 개수 - 1 만큼 역참조 (포인터)
    for (let j = 0; j < geoCount - 1; j++) {
        addr = memory[addr] || 0;
    }
    return addr;
}

// 기존 문자열 기반 resolveAddr는 하위 호환용으로 유지
function resolveAddr(memStr) {
    const trimmed = memStr.trim();
    // 순수 그+거* 패턴이면 빠른 처리
    if (/^그+거*$/.test(trimmed)) {
        let geuCount = (trimmed.match(/그/g) || []).length;
        let geoCount = (trimmed.match(/거/g) || []).length;
        let addr = geuCount;
        for (let i = 0; i < geoCount - 1; i++) addr = memory[addr] || 0;
        return addr;
    }
    // 그 외: 토크나이징 후 토큰 기반으로 처리
    const tokens = tokenizeLine(trimmed).filter(t => t.type !== 'text' && t.type !== 'comment');
    return resolveAddrFromTokens(tokens);
}

// --- Ghost Hover (원본 그대로) ---
let currentHoverAddr = null;

editor.addEventListener('mousemove', (e) => {
    if (isDebugMode) return;
    editor.style.pointerEvents = 'none';
    highlightView.style.pointerEvents = 'auto';
    const el = document.elementFromPoint(e.clientX, e.clientY);
    highlightView.style.pointerEvents = 'none';
    editor.style.pointerEvents = 'auto';
    if (el && el.classList.contains('tok-mem')) {
        hoverMem(el.getAttribute('data-addr'));
    } else {
        clearHover();
    }
});

editor.addEventListener('mouseleave', clearHover);

function hoverMem(addr) {
    if (currentHoverAddr === addr) return;
    clearHover();
    currentHoverAddr = addr;
    document.querySelectorAll(`.tok-mem[data-addr="${addr}"]`).forEach(el => el.classList.add('highlight'));
}

function clearHover() {
    if (currentHoverAddr === null) return;
    document.querySelectorAll('.tok-mem.highlight').forEach(el => el.classList.remove('highlight'));
    currentHoverAddr = null;
}

// --- 토크나이저 ---
// [변경] 그+거+ 를 한 덩어리로 묶던 방식 제거
// 대신 그+ 와 거+ 를 별도 토큰(num / geo)으로 분리
// → 파서가 수식+거 형태의 동적 주소를 인식할 수 있게 됨
function tokenizeLine(text) {
    // 변경: (그+거+) 제거, 대신 (거+) 를 독립 패턴으로 추가
    const regex = /(#.*)|(그+)|(거+)|(진짜뭐지|진짜뭐냐|뭐더라|뭐지|뭐냐|있잖아)|(아|어)|(\.\.\.|\.\.|\.|,,|,|;;|;|~)/g;
    let tokens = [];
    let lastIdx = 0;

    text.replace(regex, (match, comm, num, geo, cmd, bracket, op, offset) => {
        if (offset > lastIdx) tokens.push({ type: 'text', val: text.slice(lastIdx, offset) });
        if      (comm)    tokens.push({ type: 'comment', val: comm });
        else if (num)     tokens.push({ type: 'num',     val: num });
        else if (geo)     tokens.push({ type: 'geo',     val: geo }); // 거+ 독립 토큰
        else if (cmd)     tokens.push({ type: 'cmd',     val: cmd });
        else if (bracket) tokens.push({ type: 'bracket', val: bracket });
        else if (op)      tokens.push({ type: 'op',      val: op });
        lastIdx = offset + match.length;
    });

    if (lastIdx < text.length) tokens.push({ type: 'text', val: text.slice(lastIdx) });
    return tokens;
}

function renderTokens(tokens) {
    // geo 토큰은 mem 처럼 렌더링 (주소 계산은 컨텍스트가 필요해서 단순 표시만)
    return tokens.map(t => {
        if (t.type === 'geo') return `<span class="tok-mem">${t.val}</span>`;
        return `<span class="tok-${t.type}">${t.val}</span>`;
    }).join('');
}

function updateHighlight() {
    const lines = editor.value.split('\n');
    highlightView.innerHTML = lines.map(line => `<div class="line">${renderTokens(tokenizeLine(line))} </div>`).join('');
    if (isDebugMode) {
        debugView.innerHTML = lines.map((line, i) => `<div id="line-${i}" class="line">${renderTokens(tokenizeLine(line))}</div>`).join('');
        if (document.getElementById(`line-${pc}`)) document.getElementById(`line-${pc}`).classList.add('active');
    }
    syncScroll();
}

function syncScroll() { highlightView.scrollTop = editor.scrollTop; }

function toggleMode() {
    if (!isDebugMode) {
        isDebugMode = true;
        updateHighlight();
        editor.style.display = 'none'; highlightView.style.display = 'none'; debugView.style.display = 'block';
        document.getElementById('btn-step').style.display = 'inline-block';
        document.getElementById('btn-mode').innerText = '✏️ 편집 모드 전환';
        document.getElementById('status-text').innerText = '모드: 실행/디버그';
        pc = 0; memory = {}; consoleElem.innerHTML = ""; currentOutSpan = null;
        updateMemoryView();
        log(">> 실행 모드 진입", "#d8d8d8");
        log(">>> 실행 시작");
    } else {
        isDebugMode = false;
        editor.style.display = 'block'; highlightView.style.display = 'block'; debugView.style.display = 'none';
        document.getElementById('btn-step').style.display = 'none';
        document.getElementById('btn-mode').innerText = '⚙️ 실행 모드 전환';
        document.getElementById('status-text').innerText = '모드: 편집 중';
    }
}

function requestConsoleInput(promptMsg) {
    return new Promise((resolve) => {
        currentOutSpan = null;
        document.getElementById('btn-step').disabled = true;
        const inputContainer = document.createElement('div');
        inputContainer.style.color = "#8be9fd";
        const promptSpan = document.createElement('span');
        promptSpan.innerText = promptMsg + " ";
        const inputField = document.createElement('input');
        inputField.type = 'text';
        inputField.style.background = 'transparent';
        inputField.style.border = 'none';
        inputField.style.borderBottom = '1px solid #8be9fd';
        inputField.style.color = '#f8f8f2';
        inputField.style.outline = 'none';
        inputField.style.fontFamily = 'inherit';
        inputField.style.width = '50px';
        inputContainer.appendChild(promptSpan);
        inputContainer.appendChild(inputField);
        consoleElem.appendChild(inputContainer);
        consoleElem.scrollTop = consoleElem.scrollHeight;
        inputField.focus();
        pendingInputField = inputField;
        pendingInputResolve = resolve;
        inputField.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                const val = inputField.value;
                const textSpan = document.createElement('span');
                textSpan.style.color = '#f1fa8c';
                textSpan.innerText = val;
                inputContainer.replaceChild(textSpan, inputField);
                document.getElementById('btn-step').disabled = false;
                pendingInputField = null;
                pendingInputResolve = null;
                resolve(val);
            }
        });
    });
}

// --- 수식 파서 ---
// [변경] geo 토큰(거+)을 파서가 인식하도록 확장
// parseAtom에서 geo 토큰이 나오면 앞의 수식과 합쳐서 동적 주소로 처리
// getVal(문자열) → 내부에서 tokenizeLine 후 getValFromTokens 호출

function getValFromTokens(toks) {
    if (toks.length === 0) return 0;
    let pos = 0;
    const consume = () => toks[pos++];
    const peek    = () => toks[pos];

    function parseAtom() {
        let t = consume();
        if (!t) return 0;

        if (t.type === 'bracket' && t.val === '아') {
            let res = parseExpr();
            consume(); // 어 소비

            // [변경 핵심] 닫는 어 다음에 거+ 가 오면 동적 주소로 처리
            // 예) 아그,,그어거 → res=3, 거×1 → memory[3] 의 값
            if (peek() && peek().type === 'geo') {
                const geoTok = consume();
                const geoCount = geoTok.val.length;
                let addr = res;
                // 거 개수만큼 역참조 (거×1이면 직접 주소, 거×2면 1단계 포인터)
                for (let i = 0; i < geoCount - 1; i++) addr = memory[addr] || 0;
                return memory[addr] || 0;
            }

            return res;
        }

        if (t.type === 'num') {
            const geuLen = t.val.length; // 그 개수

            // [변경 핵심] 그+ 다음에 거+ 가 오면 메모리 주소로 처리
            // 예) 그그거 → geuLen=2, geoCount=1 → memory[2]
            if (peek() && peek().type === 'geo') {
                const geoTok = consume();
                const geoCount = geoTok.val.length;
                let addr = geuLen;
                for (let i = 0; i < geoCount - 1; i++) addr = memory[addr] || 0;
                return memory[addr] || 0;
            }

            // 거 없으면 그냥 숫자
            return geuLen;
        }

        return 0;
    }

    function parseFactor() {
        let node = parseAtom();
        while (peek() && peek().type === 'op' && ['.', '..', '...'].includes(peek().val)) {
            let op = consume().val, right = parseAtom();
            if (op === '.') node *= right;
            else if (op === '..') node = Math.floor(node / right);
            else node %= right;
        }
        return node;
    }

    function parseTerm() {
        let node = parseFactor();
        while (peek() && peek().type === 'op' && [',', ',,'].includes(peek().val)) {
            let op = consume().val, right = parseFactor();
            node = op === ',' ? node + right : node - right;
        }
        return node;
    }

    function parseExpr() {
        let node = parseTerm();
        while (peek() && peek().type === 'op' && ['~', ';', ';;'].includes(peek().val)) {
            let op = consume().val, right = parseTerm();
            if (op === '~')       node = node === right ? 1 : 0;
            else if (op === ';')  node = node > right   ? 1 : 0;
            else                  node = node >= right  ? 1 : 0;
        }
        return node;
    }

    return parseExpr();
}

function getVal(expr) {
    const toks = tokenizeLine(expr).filter(t => t.type !== 'text' && t.type !== 'comment');
    return getValFromTokens(toks);
}

// --- 실행 로직 ---
// [변경] 명령어 파싱에서 주소 추출 방식을 토큰 기반으로 변경
// fullLine.replace("뭐더라", "") 대신 토큰에서 cmd 위치를 찾아 분리
async function takeStep() {
    if (!isDebugMode) toggleMode();
    document.querySelectorAll('.line.active').forEach(el => el.classList.remove('active'));
    let linesArr = editor.value.split('\n');
    if (pc < 0 || pc >= linesArr.length) { log("\n>>> 프로그램 종료."); return false; }

    const lineEl = document.getElementById(`line-${pc}`);
    if (lineEl) { lineEl.classList.add('active'); lineEl.scrollIntoView({ behavior: 'smooth', block: 'center' }); }

    let fullLine = linesArr[pc].split('#')[0].trim();
    let jumped = false;

    if (fullLine) {
        try {
            // 토큰 기반으로 명령어와 좌우 피연산자 분리
            const allToks = tokenizeLine(fullLine).filter(t => t.type !== 'text' && t.type !== 'comment');
            const cmdIdx  = allToks.findIndex(t => t.type === 'cmd');

            if (cmdIdx !== -1) {
                const cmdVal   = allToks[cmdIdx].val;
                const leftToks = allToks.slice(0, cmdIdx);   // 명령어 왼쪽 토큰들
                const rightToks= allToks.slice(cmdIdx + 1);  // 명령어 오른쪽 토큰들

                // 왼쪽 토큰들로 주소 계산
                // 예) "아그,,그어거 뭐더라 ..." → leftToks=[아,그,,,그,어,거]
                const getLeftAddr = () => resolveAddrFromTokens(leftToks);

                if (cmdVal === '뭐더라') {
                    memory[getLeftAddr()] = getValFromTokens(rightToks);
                }
                else if (cmdVal === '진짜뭐지') {
                    const targetAddr = getLeftAddr();
                    const val = await requestConsoleInput(`[${targetAddr}번] 문자 입력:`);
                    if (val === null) return false;
                    memory[targetAddr] = (val && val.length > 0) ? val.charCodeAt(0) : 0;
                }
                else if (cmdVal === '진짜뭐냐') {
                    printOut(String.fromCharCode(getValFromTokens(rightToks)));
                }
                else if (cmdVal === '뭐지') {
                    const targetAddr = getLeftAddr();
                    const val = await requestConsoleInput(`[${targetAddr}번] 숫자 입력:`);
                    if (val === null) return false;
                    memory[targetAddr] = parseInt(val) || 0;
                }
                else if (cmdVal === '뭐냐') {
                    printOut(getValFromTokens(rightToks));
                }
                else if (cmdVal === '있잖아') {
                    pc += getValFromTokens(rightToks);
                    jumped = true;
                }
            }
        } catch (err) { log(`\nError: ${err}`, "#ff5555"); }
    }

    if (!jumped) pc++;
    updateMemoryView();
    updateHighlight();
    return true;
}

async function runAll() {
    let startFromEditMode = !isDebugMode;
    if (!isDebugMode) toggleMode();
    if (isRunning) return;
    isRunning = true;
    let stepCount = 0;
    document.getElementById('btn-run').style.display = 'none';
    document.getElementById('btn-stop').style.display = 'inline-block';
    document.getElementById('btn-step').disabled = true;
    while (isRunning && await takeStep()) {
        stepCount++;
        if (stepCount % 50 === 0) await new Promise(resolve => setTimeout(resolve, 0));
    }
    if (isRunning) stopRun(false);
    if (startFromEditMode) {
        setTimeout(() => {
            if (isDebugMode) toggleMode();
            log(">> 편집 모드로 복귀함", "#d8d8d8");
        }, 300);
    }
}

function stopRun(isForced = true) {
    isRunning = false;
    document.getElementById('btn-run').style.display = 'inline-block';
    document.getElementById('btn-stop').style.display = 'none';
    document.getElementById('btn-step').disabled = false;
    if (pendingInputResolve) {
        if (pendingInputField && pendingInputField.parentNode) {
            const cancelSpan = document.createElement('span');
            cancelSpan.style.color = '#ff5555';
            cancelSpan.innerText = "[입력 취소됨]";
            pendingInputField.parentNode.replaceChild(cancelSpan, pendingInputField);
        }
        pendingInputResolve(null);
        pendingInputResolve = null;
        pendingInputField = null;
    }
    if (isForced) log("\n>>> 사용자에 의해 강제 중지됨", "#ff5555");
}

function resetAll() {
    stopRun(false);
    memory = {};
    pc = 0;
    currentOutSpan = null;
    consoleElem.innerHTML = "# 리셋됨";
    updateMemoryView();
    if (isDebugMode) toggleMode();
    updateHighlight();
}

function updateMemoryView() {
    memContent.innerHTML = Object.entries(memory).sort((a, b) => a[0] - b[0])
        .map(([k, v]) => {
            let chrPreview = (v >= 32 && v <= 126) ? ` ('${String.fromCharCode(v)}')` : '';
            return `<div><span style="color:var(--mem)">[${k}번]</span>: ${v}${chrPreview}</div>`;
        }).join('');
}

window.addEventListener('beforeunload', function(e) {
    if (editor.value.trim() !== '') {
        e.preventDefault();
        e.returnValue = '';
    }
});

editor.value = "";
updateHighlight();
log("# 준비 완료");
