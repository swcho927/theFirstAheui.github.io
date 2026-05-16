
let memory = {};
let pc = 0;
let isDebugMode = false;
let currentOutSpan = null; // 줄바꿈 없는 출력을 위한 변수
let isRunning = false;
let pendingInputResolve = null;
let pendingInputField = null;

const editor = document.getElementById('editor');
const highlightView = document.getElementById('highlight-view');
const debugView = document.getElementById('debug-view');
const consoleElem = document.getElementById('console');
const memContent = document.getElementById('mem-content');

// --- 출력 및 시스템 로그 컨트롤 ---
function printOut(msg) {
    if (!currentOutSpan) {
        currentOutSpan = document.createElement('span');
        currentOutSpan.style.color = "#f1fa8c"; // 노란색 (표준 출력)
        consoleElem.appendChild(currentOutSpan);
    }
    currentOutSpan.innerText += msg;
    consoleElem.scrollTop = consoleElem.scrollHeight;
}

function log(msg, color="#50fa7b") {
    currentOutSpan = null; // 다음 출력 시 새로운 span 생성 유도
    const div = document.createElement('div');
    div.style.color = color;
    div.innerText = msg;
    consoleElem.appendChild(div);
    consoleElem.scrollTop = consoleElem.scrollHeight;
}

// ── 주소 해결기 ──
// [변경] 동적 주소 지원 추가
// 기존: 그+거+ 패턴만 처리 (그 개수 = 주소)
// 추가: 앞에 수식이 있으면 getVal()로 계산한 값을 주소로 사용
// 예) "아그그,,그어거" → getVal("아그그,,그어") = 3 → 3번 주소
function resolveAddr(memStr) {
    const trimmed = memStr.trim();

    // 기존 동작: 순수하게 그+거* 패턴이면 원본 방식 그대로
    if (/^그+거*$/.test(trimmed)) {
        let geuCount = (trimmed.match(/그/g) || []).length;
        let geoCount = (trimmed.match(/거/g) || []).length;
        let addr = geuCount;
        for (let i = 0; i < geoCount - 1; i++) {
            addr = memory[addr] || 0;
        }
        return addr;
    }

    // 확장 동작: 마지막 거+ 를 분리하고 앞부분을 수식으로 평가
    // "아그그,,그어거거" → exprPart="아그그,,그어", geoPart="거거"
    const match = trimmed.match(/^(.*?)(거+)$/);
    if (match) {
        const exprPart = match[1];
        const geoCount = match[2].length;
        let addr = getVal(exprPart); // 수식 결과를 주소로
        for (let i = 0; i < geoCount - 1; i++) {
            addr = memory[addr] || 0;
        }
        return addr;
    }

    // fallback: 원본 방식
    let geuCount = (trimmed.match(/그/g) || []).length;
    let geoCount = (trimmed.match(/거/g) || []).length;
    let addr = geuCount;
    for (let i = 0; i < geoCount - 1; i++) {
        addr = memory[addr] || 0;
    }
    return addr;
}

// --- Ghost Hover 로직 개선 (최종 수정본) ---
let currentHoverAddr = null;

editor.addEventListener('mousemove', (e) => {
    if (isDebugMode) return;
    
    // 1. 에디터의 마우스 이벤트를 일시적으로 끄기 (밑을 투시하기 위해)
    editor.style.pointerEvents = 'none';
    
    // 💡 2. 핵심: elementFromPoint가 글자를 인식할 수 있도록 highlight-view 잠깐 켜기!
    highlightView.style.pointerEvents = 'auto';
    
    // 3. 그 위치의 아래에 있는 요소 가져오기
    const el = document.elementFromPoint(e.clientX, e.clientY);
    
    // 4. 즉시 두 요소 모두 원상 복구
    highlightView.style.pointerEvents = 'none';
    editor.style.pointerEvents = 'auto';

    // 5. 요소가 메모리 토큰인지 확인하고 하이라이팅
    if (el && el.classList.contains('tok-mem')) {
        hoverMem(el.getAttribute('data-addr'));
    } else {
        clearHover();
    }
});

// 마우스가 에디터 밖으로 나가면 하이라이트 깔끔하게 지우기
editor.addEventListener('mouseleave', clearHover);

function hoverMem(addr) { 
    if (currentHoverAddr === addr) return; 
    
    clearHover(); 
    currentHoverAddr = addr;
    
    document.querySelectorAll(`.tok-mem[data-addr="${addr}"]`).forEach(el => {
        el.classList.add('highlight');
    }); 
}

function clearHover() { 
    if (currentHoverAddr === null) return; 
    
    document.querySelectorAll('.tok-mem.highlight').forEach(el => {
        el.classList.remove('highlight');
    }); 
    currentHoverAddr = null;
}

// --- 토큰 및 렌더링 ---
function tokenizeLine(text) {
    // 정규식에 '진짜뭐지', '진짜뭐냐' 우선순위 반영
    const regex = /(#.*)|(그+거+)|(그+)|(진짜뭐지|진짜뭐냐|뭐더라|뭐지|뭐냐|있잖아)|(아|어)|(\.\.\.|\.\.|\.|,,|,|;;|;|~)/g;
    let tokens = [];
    let lastIdx = 0;
    
    text.replace(regex, (match, comm, mem, num, cmd, bracket, op, offset) => {
        if (offset > lastIdx) tokens.push({ type: 'text', val: text.slice(lastIdx, offset) });
        if (comm) tokens.push({ type: 'comment', val: comm });
        else if (mem) tokens.push({ type: 'mem', val: mem, addr: resolveAddr(mem) });
        else if (num) tokens.push({ type: 'num', val: num });
        else if (cmd) tokens.push({ type: 'cmd', val: cmd });
        else if (bracket) tokens.push({ type: 'bracket', val: bracket });
        else if (op) tokens.push({ type: 'op', val: op });
        lastIdx = offset + match.length;
    });
    if (lastIdx < text.length) tokens.push({ type: 'text', val: text.slice(lastIdx) });
    return tokens;
}

function renderTokens(tokens) {
    return tokens.map(t => {
        if (t.type === 'mem') return `<span class="tok-mem" data-addr="${t.addr}" title="주소: ${t.addr}번">${t.val}</span>`;
        return `<span class="tok-${t.type}">${t.val}</span>`;
    }).join('');
}

function updateHighlight() {
    const lines = editor.value.split('\n');
    highlightView.innerHTML = lines.map(line => `<div class="line">${renderTokens(tokenizeLine(line))} </div>`).join('');
    if(isDebugMode) {
        debugView.innerHTML = lines.map((line, i) => `<div id="line-${i}" class="line">${renderTokens(tokenizeLine(line))}</div>`).join('');
        if(document.getElementById(`line-${pc}`)) document.getElementById(`line-${pc}`).classList.add('active');
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
        log(">> 실행 모드 진입","#d8d8d8")
        log(">>> 실행 시작");
    } else {
        isDebugMode = false;
        editor.style.display = 'block'; highlightView.style.display = 'block'; debugView.style.display = 'none';
        document.getElementById('btn-step').style.display = 'none';
        document.getElementById('btn-mode').innerText = '⚙️ 실행 모드 전환';
        document.getElementById('status-text').innerText = '모드: 편집 중';
    }
}

// --- 콘솔 입력 대기 함수 ---
function requestConsoleInput(promptMsg) {
    return new Promise((resolve) => {
        currentOutSpan = null; // 줄바꿈을 유도하기 위해 초기화

        document.getElementById('btn-step').disabled = true;

        const inputContainer = document.createElement('div');
        inputContainer.style.color = "#8be9fd"; // 입력 안내 메시지 색상 (Cyan)
        
        const promptSpan = document.createElement('span');
        promptSpan.innerText = promptMsg + " ";
        
        const inputField = document.createElement('input');
        inputField.type = 'text';
        // 에디터 테마에 맞춘 입력칸 스타일
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
        
        inputField.focus(); // 생성되자마자 바로 입력할 수 있게 포커스

        //강제 중지 시 제어하기 위해 전역 변수에 현재 상태 저장
        pendingInputField = inputField;
        pendingInputResolve = resolve;
        
        // Enter 키 입력 감지
        inputField.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                const val = inputField.value;
                // 입력을 완료하면 입력칸(input)을 일반 텍스트(span)로 바꿔서 기록을 남김
                const textSpan = document.createElement('span');
                textSpan.style.color = '#f1fa8c'; // 입력된 값 색상 (Yellow)
                textSpan.innerText = val;
                inputContainer.replaceChild(textSpan, inputField);

                document.getElementById('btn-step').disabled = false; //입력 종료시 디버깅 중 다음단계 버튼 활성화
                pendingInputField = null;
                pendingInputResolve = null;

                resolve(val); // Promise 완료, 값 반환
            }
        });
    });
}

// --- 수식 파서 ---
function getVal(expr) {
    const toks = tokenizeLine(expr).filter(t => t.type !== 'text' && t.type !== 'comment');
    if (toks.length === 0) return 0;
    let pos = 0;
    const consume = () => toks[pos++];
    const peek = () => toks[pos];
    
    function parseAtom() {
        let t = consume(); if (!t) return 0;
        if (t.type === 'bracket' && t.val === '아') { let res = parseExpr(); consume(); return res; }
        if (t.type === 'mem') return memory[resolveAddr(t.val)] || 0;
        if (t.type === 'num') return t.val.length;
        return 0;
    }
    function parseFactor() {
        let node = parseAtom();
        while(peek() && peek().type === 'op' && ['.','..','...'].includes(peek().val)) {
            let op = consume().val; let right = parseAtom();
            if (op === '.') node *= right; else if (op === '..') node = Math.floor(node/right); else node %= right;
        }
        return node;
    }
    function parseTerm() {
        let node = parseFactor();
        while(peek() && peek().type === 'op' && [',',',,'].includes(peek().val)) {
            let op = consume().val; let right = parseFactor();
            if (op === ',') node += right; else node -= right;
        }
        return node;
    }
    function parseExpr() {
        let node = parseTerm();
        while(peek() && peek().type === 'op' && ['~',';',';;'].includes(peek().val)) {
            let op = consume().val; let right = parseTerm();
            if (op === '~') node = node === right ? 1 : 0; else if (op === ';') node = node > right ? 1 : 0; else if (op === ';;') node = node >= right ? 1 : 0;
        }
        return node;
    }
    return parseExpr();
}

// --- 실행 로직 ---
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
            if (fullLine.includes("뭐더라")) { 
                let [m, e] = fullLine.split("뭐더라"); 
                let targetAddr = resolveAddr(m.trim());
                memory[targetAddr] = getVal(e.trim()); 
            }
            else if (fullLine.includes("진짜뭐지")) { 
                // 문자 1개를 입력받아 ASCII/유니코드 저장
                let m = fullLine.replace("진짜뭐지", "").trim(); 
                let targetAddr = resolveAddr(m);
                let val = await requestConsoleInput(`[${targetAddr}번] 문자 입력:`);
                if (val === null) return false; // 입력 취소(강제중지) 시 스텝 종료
                memory[targetAddr] = (val && val.length > 0) ? val.charCodeAt(0) : 0; 
            }
            else if (fullLine.includes("진짜뭐냐")) { 
                // 값을 문자로 변환하여 줄바꿈 없이 출력
                printOut(String.fromCharCode(getVal(fullLine.replace("진짜뭐냐", "")))); 
            }
            else if (fullLine.includes("뭐지")) { 
                let m = fullLine.replace("뭐지", "").trim(); 
                let targetAddr = resolveAddr(m);
                let val = await requestConsoleInput(`[${targetAddr}번] 숫자 입력:`);
                if (val === null) return false; // 💡 입력 취소(강제중지) 시 스텝 종료
                memory[targetAddr] = parseInt(val) || 0; 
            }
            else if (fullLine.includes("뭐냐")) { 
                // 값을 줄바꿈 없이 출력
                printOut(getVal(fullLine.replace("뭐냐", ""))); 
            }
            else if (fullLine.includes("있잖아")) { 
                let offset = getVal(fullLine.replace("있잖아", "")); 
                pc += offset; jumped = true; 
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

    if(!isDebugMode) toggleMode(); 
    if(isRunning) return; // 이미 실행 중이면 중복 실행 방지
    
    isRunning = true;
    let stepCount = 0;
    
    // UI 버튼 상태 변경
    document.getElementById('btn-run').style.display = 'none';
    document.getElementById('btn-stop').style.display = 'inline-block';
    document.getElementById('btn-step').disabled = true;

    // isRunning이 true인 동안만 루프 실행
    while(isRunning && await takeStep()) {
        stepCount++;
        
        // 50번의 명령어마다 브라우저에게 0밀리초 휴식을 주어 화면 렌더링 및 버튼 클릭을 허용함
        if(stepCount % 50 === 0) {
            await new Promise(resolve => setTimeout(resolve, 0));
        }
    }

    // 정상 종료 시 상태 복구
    if(isRunning) stopRun(false);

    // 편집 모드에서 진입했을시 다시 편집 모드로 복귀
    if (startFromEditMode) {
        setTimeout(()=>{
            if (isDebugMode) toggleMode();
            log(">> 편집 모드로 복귀함","#d8d8d8")
        },300);
    }
}

function stopRun(isForced = true) {
    isRunning = false;
    document.getElementById('btn-run').style.display = 'inline-block';
    document.getElementById('btn-stop').style.display = 'none';
    document.getElementById('btn-step').disabled = false;

    // 대기 중인 입력창이 있다면 입력란을 막고 실행 취소
    if (pendingInputResolve) {
        if (pendingInputField && pendingInputField.parentNode) {
            const cancelSpan = document.createElement('span');
            cancelSpan.style.color = '#ff5555';
            cancelSpan.innerText = "[입력 취소됨]";
            pendingInputField.parentNode.replaceChild(cancelSpan, pendingInputField);
        }
        pendingInputResolve(null); // null을 반환하여 Promise 대기 해제
        pendingInputResolve = null;
        pendingInputField = null;
    }

    if(isForced) log("\n>>> 사용자에 의해 강제 중지됨", "#ff5555");
}

function resetAll() { 
    stopRun(false); // 실행 중이었다면 멈춤
    memory = {}; 
    pc = 0; 
    currentOutSpan = null; 
    consoleElem.innerHTML = "# 리셋됨"; 
    updateMemoryView(); 
    if(isDebugMode) toggleMode(); 
    updateHighlight(); 
}

function updateMemoryView() { 
    memContent.innerHTML = Object.entries(memory).sort((a,b)=>a[0]-b[0])
        .map(([k, v]) => {
            let chrPreview = (v >= 32 && v <= 126) ? ` ('${String.fromCharCode(v)}')` : '';
            return `<div><span style="color:var(--mem)">[${k}번]</span>: ${v}${chrPreview}</div>`;
        }).join(''); 
}

// --- 페이지 이탈 방지 (새로고침/닫기 경고) ---
window.addEventListener('beforeunload', function (e) {
    // 에디터에 코드가 단 한 글자라도 작성되어 있을 때만 경고창을 띄웁니다.
    // (빈 화면일 때는 편하게 새로고침할 수 있도록 하기 위함)
    if (editor.value.trim() !== '') {
        // 브라우저 표준에 따른 경고창 호출 방식
        e.preventDefault();
        e.returnValue = ''; 
    }
});

// 신규 예제 코드
editor.value = "";
updateHighlight();
log("# 준비 완료");
