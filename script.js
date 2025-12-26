/* AI 邏輯控制器 (MCTS) */
class GoAI {
    constructor(game, difficulty) {
        this.game = game;
        this.difficulty = difficulty;
    }
    makeMove() {
        return new Promise(resolve => {
            const thinkTime = 800; 
            setTimeout(() => {
                let move;
                try {
                    move = (this.difficulty === 'hard') ? this.getAdvancedMove() : this.getEasyMove();
                } catch(e) { move = null; }
                resolve(move);
            }, thinkTime);
        });
    }
    getEasyMove() {
        const size = this.game.boardSize;
        const validMoves = [];
        for(let y=0; y<size; y++) for(let x=0; x<size; x++) 
            if(this.game.isValidMove(x, y, 2)) validMoves.push({x, y});
        
        for(let move of validMoves) {
            const result = this.game.simulateMove(move.x, move.y, 2);
            if(result.capturedCount > 0) return move;
        }
        if (validMoves.length > 0) return validMoves[Math.floor(Math.random() * validMoves.length)];
        return null;
    }
    getAdvancedMove() {
        const size = this.game.boardSize;
        let bestScore = -Infinity;
        let bestMoves = [];
        for(let y=0; y<size; y++) {
            for(let x=0; x<size; x++) {
                if(!this.game.isValidMove(x, y, 2)) continue;
                const score = this.evaluateMove(x, y);
                if (score > bestScore) { bestScore = score; bestMoves = [{x, y}]; }
                else if (score === bestScore) { bestMoves.push({x, y}); }
            }
        }
        if(bestMoves.length > 0) return bestMoves[Math.floor(Math.random() * bestMoves.length)];
        return null;
    }
    evaluateMove(x, y) {
        let score = 0;
        const result = this.game.simulateMove(x, y, 2);
        if (result.capturedCount > 0) score += result.capturedCount * 100;
        if (result.liberties === 1) score -= 50; 
        if (result.liberties > 1) score += 10;
        if (x===4 && y===4) score += 15;
        if ((x===2||x===6)&&(y===2||y===6)) score += 5;
        score += Math.random() * 5;
        return score;
    }
}

/* 遊戲核心邏輯 */
class GoGame {
    constructor(canvasId, boardSize = 9, mode = 'pvp', difficulty = 'easy') {
        this.canvas = document.getElementById(canvasId);
        this.ctx = this.canvas.getContext('2d');
        this.boardContainer = document.getElementById('board-container');
        
        this.boardSize = boardSize;
        this.mode = mode;
        this.gridSize = 0;
        this.padding = 30;
        
        this.board = []; 
        this.history = []; 
        this.turn = 1; 
        this.captures = { 1: 0, 2: 0 };
        this.lastMove = null;
        this.koPosition = null;
        this.passCounter = 0;
        this.isGameOver = false;
        this.isAiThinking = false;
        this.isScoringPhase = false; 

        if (this.mode === 'cpu') {
            this.ai = new GoAI(this, difficulty);
        }

        this.init();
    }

    init() {
        this.resetBoard();
        setTimeout(() => this.resize(), 50);
        window.addEventListener('resize', () => this.resize());
        
        const clickHandler = (e) => {
            if (this.isAiThinking) return;
            if (this.isGameOver && !this.isScoringPhase) return; 
            if (!this.isScoringPhase && this.mode === 'cpu' && this.turn === 2) return;

            const rect = this.canvas.getBoundingClientRect();
            const clientX = e.clientX || (e.touches && e.touches[0].clientX);
            const clientY = e.clientY || (e.touches && e.touches[0].clientY);
            
            if (clientX && clientY) {
                this.handleInput(clientX - rect.left, clientY - rect.top);
            }
        };
        this.canvas.onclick = clickHandler;
        this.canvas.ontouchstart = (e) => { e.preventDefault(); clickHandler(e); };
    }

    resize() {
        if (!this.boardContainer) return;
        const containerW = this.boardContainer.clientWidth;
        const containerH = this.boardContainer.clientHeight;
        const size = Math.floor(Math.min(containerW, containerH) - 40);
        
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width = size * dpr;
        this.canvas.height = size * dpr;
        this.canvas.style.width = `${size}px`;
        this.canvas.style.height = `${size}px`;
        this.ctx.scale(dpr, dpr);
        this.gridSize = (size - this.padding * 2) / (this.boardSize - 1);
        this.draw();
    }

    resetBoard() {
        this.board = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0));
        this.turn = 1;
        this.captures = { 1: 0, 2: 0 };
        this.history = [];
        this.lastMove = null;
        this.koPosition = null;
        this.passCounter = 0;
        this.isGameOver = false;
        this.isAiThinking = false;
        this.isScoringPhase = false;
        
        document.getElementById('score-modal').style.display = 'none';
        document.getElementById('ai-thinking').style.display = 'none';
        document.getElementById('atari-warning').classList.remove('show');
        document.getElementById('btn-finish-scoring').style.display = 'none';
        
        this.updateUI();
        this.resize();
    }

    handleInput(pixelX, pixelY) {
        const x = Math.round((pixelX - this.padding) / this.gridSize);
        const y = Math.round((pixelY - this.padding) / this.gridSize);

        if (this.isScoringPhase) {
            this.removeDeadGroup(x, y);
            return;
        }
        this.attemptMove(x, y);
    }

    removeDeadGroup(x, y) {
        if (!this.isOnBoard(x, y)) return;
        const color = this.board[y][x];
        if (color === 0) return;

        const group = this.getGroup(x, y, this.board);
        group.stones.forEach(s => {
            this.board[s.y][s.x] = 0;
        });
        const opponent = color === 1 ? 2 : 1;
        this.captures[opponent] += group.stones.length;

        this.draw();
        this.updateUI();
    }

    async attemptMove(x, y) {
        if (!this.isOnBoard(x, y)) return;
        if (this.isValidMove(x, y, this.turn)) {
            this.executeMove(x, y, this.turn);
            this.passCounter = 0; 
            this.checkAtari();
            if (this.mode === 'cpu' && !this.isGameOver && this.turn === 2) {
                await this.playAiTurn();
            }
        }
    }

    async playAiTurn() {
        if (this.isAiThinking) return;
        this.isAiThinking = true;
        document.getElementById('ai-thinking').style.display = 'flex';
        const aiMove = await this.ai.makeMove();
        document.getElementById('ai-thinking').style.display = 'none';
        this.isAiThinking = false;

        if (aiMove) {
            this.executeMove(aiMove.x, aiMove.y, 2);
            this.passCounter = 0;
            this.checkAtari();
        } else {
            this.passTurn();
        }
    }

    checkAtari() {
        const currentTurnPlayer = this.turn; 
        let atariFound = false;
        const checkedGroups = new Set();
        for(let y=0; y<this.boardSize; y++) {
            for(let x=0; x<this.boardSize; x++) {
                if (this.board[y][x] === currentTurnPlayer && !checkedGroups.has(`${x},${y}`)) {
                    const group = this.getGroup(x, y, this.board);
                    group.stones.forEach(s => checkedGroups.add(`${s.x},${s.y}`));
                    if (group.liberties === 1) atariFound = true;
                }
            }
        }
        const alertEl = document.getElementById('atari-warning');
        if (atariFound) alertEl.classList.add('show');
        else alertEl.classList.remove('show');
    }

    passTurn() {
        if (this.isGameOver || this.isAiThinking) return;
        this.turn = this.turn === 1 ? 2 : 1;
        this.lastMove = null;
        this.koPosition = null;
        this.passCounter++;
        this.updateUI();

        if (this.passCounter >= 2) {
            this.enterScoringPhase();
            return;
        }
        if(this.mode === 'cpu' && this.turn === 2) {
            this.playAiTurn();
        }
    }

    enterScoringPhase() {
        this.isScoringPhase = true;
        document.getElementById('game-message').innerText = "請點擊死子移除";
        document.getElementById('game-message').style.color = "#c77f67"; 
        document.getElementById('btn-finish-scoring').style.display = 'flex';
        alert("棋局暫停！\n請點擊棋盤上「對手的死子」將其移除。\n清理乾淨後，請按「✅ 死子已清，計算勝負」。");
    }

    finalizeScore() {
        this.isScoringPhase = false;
        document.getElementById('btn-finish-scoring').style.display = 'none';
        this.endGame();
    }

    endGame() {
        this.isGameOver = true;
        const score = this.calculateScore();
        const modal = document.getElementById('score-modal');
        const details = document.getElementById('score-details');
        const winnerText = document.getElementById('winner-text');
        
        this.drawTerritory(score.territoryMap);

        const komi = 5.5; 
        const totalBlack = score.black + this.captures[1];
        const totalWhite = score.white + this.captures[2] + komi;
        let winner = totalBlack > totalWhite ? "黑棋勝" : "白棋勝";

        details.innerHTML = `
            <div style="margin-bottom: 15px; border-bottom: 1px dashed #8d6e53; padding-bottom: 10px;">
                <span>🟤 黑方 (客)</span><br>
                <span style="font-size: 0.9em">盤面 ${score.black} + 提子 ${this.captures[1]} = <strong>${totalBlack} 目</strong></span>
            </div>
            <div>
                <span>⚪ 白方 (茶友)</span><br>
                <span style="font-size: 0.9em">盤面 ${score.white} + 提子 ${this.captures[2]} + 貼目 ${komi} = <strong>${totalWhite} 目</strong></span>
            </div>
        `;
        winnerText.innerText = winner;
        modal.style.display = 'flex';
    }

    calculateScore() {
        let blackTerritory = 0;
        let whiteTerritory = 0;
        let territoryMap = Array(this.boardSize).fill().map(() => Array(this.boardSize).fill(0)); 
        const visited = new Set();

        for(let y=0; y<this.boardSize; y++) {
            for(let x=0; x<this.boardSize; x++) {
                if (this.board[y][x] === 0 && !visited.has(`${x},${y}`)) {
                    const region = [];
                    const stack = [{x, y}];
                    let touchBlack = false;
                    let touchWhite = false;
                    
                    while(stack.length > 0) {
                        const curr = stack.pop();
                        const key = `${curr.x},${curr.y}`;
                        if (visited.has(key)) continue;
                        visited.add(key);
                        region.push(curr);

                        const neighbors = [[0,1],[0,-1],[1,0],[-1,0]];
                        neighbors.forEach(([dx, dy]) => {
                            const nx = curr.x + dx, ny = curr.y + dy;
                            if (this.isOnBoard(nx, ny)) {
                                const state = this.board[ny][nx];
                                if (state === 0) stack.push({x: nx, y: ny});
                                else if (state === 1) touchBlack = true;
                                else if (state === 2) touchWhite = true;
                            }
                        });
                    }

                    let owner = 0;
                    if (touchBlack && !touchWhite) { blackTerritory += region.length; owner = 1; }
                    else if (touchWhite && !touchBlack) { whiteTerritory += region.length; owner = 2; }
                    region.forEach(p => territoryMap[p.y][p.x] = owner);
                }
            }
        }
        return { black: blackTerritory, white: whiteTerritory, territoryMap: territoryMap };
    }

    isValidMove(x, y, color) {
        if (!this.isOnBoard(x, y)) return false;
        if (this.board[y][x] !== 0) return false;
        if (this.koPosition && this.koPosition.x === x && this.koPosition.y === y) return false;
        const sim = this.simulateMove(x, y, color);
        if (sim.liberties === 0 && sim.capturedCount === 0) return false;
        return true;
    }

    simulateMove(x, y, color) {
        const testBoard = JSON.parse(JSON.stringify(this.board));
        testBoard[y][x] = color;
        const opponent = color === 1 ? 2 : 1;
        let capturedCount = 0;
        const neighbors = [[0,1],[0,-1],[1,0],[-1,0]];
        neighbors.forEach(([dx, dy]) => {
            const nx = x+dx, ny = y+dy;
            if(this.isOnBoard(nx, ny) && testBoard[ny][nx] === opponent) {
                const group = this.getGroup(nx, ny, testBoard);
                if(group.liberties === 0) {
                    capturedCount += group.stones.length;
                    group.stones.forEach(s => testBoard[s.y][s.x] = 0);
                }
            }
        });
        const myGroup = this.getGroup(x, y, testBoard);
        return { liberties: myGroup.liberties, capturedCount: capturedCount, boardAfter: testBoard };
    }

    executeMove(x, y, color) {
        this.history.push({
            board: JSON.parse(JSON.stringify(this.board)),
            turn: this.turn,
            captures: {...this.captures},
            lastMove: this.lastMove,
            koPosition: this.koPosition
        });
        this.board[y][x] = color;
        const opponent = color === 1 ? 2 : 1;
        let capturedStones = [];
        const neighbors = [[0,1],[0,-1],[1,0],[-1,0]];
        neighbors.forEach(([dx, dy]) => {
            const nx = x+dx, ny = y+dy;
            if(this.isOnBoard(nx, ny) && this.board[ny][nx] === opponent) {
                const group = this.getGroup(nx, ny, this.board);
                if(group.liberties === 0) capturedStones.push(...group.stones);
            }
        });
        capturedStones.forEach(pos => this.board[pos.y][pos.x] = 0);
        this.captures[color] += capturedStones.length;
        
        const myGroup = this.getGroup(x, y, this.board);
        if (capturedStones.length === 1 && myGroup.stones.length === 1 && myGroup.liberties === 1) {
            this.koPosition = capturedStones[0];
        } else {
            this.koPosition = null;
        }
        
        this.lastMove = { x, y };
        this.playSound(color);
        this.turn = opponent;
        this.updateUI();
        this.draw();
    }

    getGroup(startX, startY, boardState) {
        const color = boardState[startY][startX];
        const group = [];
        const visited = new Set();
        const stack = [{x: startX, y: startY}];
        let liberties = 0;
        const countedLiberties = new Set();
        while(stack.length > 0) {
            const {x, y} = stack.pop();
            const key = `${x},${y}`;
            if(visited.has(key)) continue;
            visited.add(key);
            group.push({x, y});
            const neighbors = [[0,1],[0,-1],[1,0],[-1,0]];
            neighbors.forEach(([dx, dy]) => {
                const nx = x+dx, ny = y+dy;
                if(!this.isOnBoard(nx, ny)) return;
                const state = boardState[ny][nx];
                if(state === 0) {
                    if(!countedLiberties.has(`${nx},${ny}`)) {
                        liberties++;
                        countedLiberties.add(`${nx},${ny}`);
                    }
                } else if(state === color) stack.push({x: nx, y: ny});
            });
        }
        return { stones: group, liberties };
    }

    isOnBoard(x, y) { return x >= 0 && x < this.boardSize && y >= 0 && y < this.boardSize; }

    draw() {
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.beginPath();
        this.ctx.strokeStyle = '#5c4a3d'; 
        this.ctx.lineWidth = 1.2; 
        for(let i=0; i<this.boardSize; i++) {
            const pos = this.padding + i * this.gridSize;
            this.ctx.moveTo(this.padding, pos); this.ctx.lineTo(this.padding + (this.boardSize-1)*this.gridSize, pos);
            this.ctx.moveTo(pos, this.padding); this.ctx.lineTo(pos, this.padding + (this.boardSize-1)*this.gridSize);
        }
        this.ctx.stroke();
        
        this.ctx.fillStyle = '#4a3b2b';
        const stars = [2, 6];
        const center = 4;
        this.ctx.beginPath(); this.ctx.arc(this.padding + center*this.gridSize, this.padding + center*this.gridSize, 3.5, 0, Math.PI*2); this.ctx.fill();
        stars.forEach(x => stars.forEach(y => {
            this.ctx.beginPath(); this.ctx.arc(this.padding + x*this.gridSize, this.padding + y*this.gridSize, 3.5, 0, Math.PI*2); this.ctx.fill();
        }));
        
        for(let y=0; y<this.boardSize; y++) for(let x=0; x<this.boardSize; x++) {
            if(this.board[y][x] !== 0) this.drawStone(x, y, this.board[y][x]);
        }
        
        if(this.lastMove) {
            const cx = this.padding + this.lastMove.x * this.gridSize;
            const cy = this.padding + this.lastMove.y * this.gridSize;
            this.ctx.fillStyle = '#c77f67'; 
            this.ctx.beginPath(); this.ctx.arc(cx, cy, this.gridSize * 0.15, 0, Math.PI*2); this.ctx.fill();
        }
    }

    drawTerritory(map) {
        if (!map) return;
        for(let y=0; y<this.boardSize; y++) {
            for(let x=0; x<this.boardSize; x++) {
                if (map[y][x] !== 0) {
                    const cx = this.padding + x * this.gridSize;
                    const cy = this.padding + y * this.gridSize;
                    this.ctx.fillStyle = map[y][x] === 1 ? 'rgba(74, 59, 43, 0.4)' : 'rgba(244, 237, 228, 0.5)';
                    this.ctx.beginPath();
                    this.ctx.fillRect(cx - 6, cy - 6, 12, 12);
                    this.ctx.fill();
                }
            }
        }
    }

    drawStone(x, y, color) {
        const cx = this.padding + x * this.gridSize;
        const cy = this.padding + y * this.gridSize;
        const r = this.gridSize * 0.45;
        this.ctx.beginPath();
        this.ctx.shadowColor = 'rgba(92, 74, 61, 0.5)'; this.ctx.shadowBlur = 4; this.ctx.shadowOffsetX = 2; this.ctx.shadowOffsetY = 2;
        this.ctx.arc(cx, cy, r, 0, Math.PI*2);
        const grad = this.ctx.createRadialGradient(cx - r*0.3, cy - r*0.3, r*0.1, cx, cy, r);
        if(color === 1) { 
            grad.addColorStop(0, '#666'); grad.addColorStop(0.4, '#3a3a3a'); grad.addColorStop(1, '#1a1a1a'); 
        } else { 
            grad.addColorStop(0, '#fff'); grad.addColorStop(0.3, '#f4f4e8'); grad.addColorStop(1, '#d0d0c0');
        }
        this.ctx.fillStyle = grad; this.ctx.fill();
        this.ctx.shadowColor = 'transparent';
    }

    // [修改] 更新 UI 時計算盤面子數
    updateUI() {
        // 計算盤面黑白子
        let blackCount = 0;
        let whiteCount = 0;
        for(let y=0; y<this.boardSize; y++) {
            for(let x=0; x<this.boardSize; x++) {
                if(this.board[y][x] === 1) blackCount++;
                else if(this.board[y][x] === 2) whiteCount++;
            }
        }

        // 更新 HTML 顯示
        document.getElementById('black-board-count').innerText = blackCount;
        document.getElementById('white-board-count').innerText = whiteCount;
        document.getElementById('black-captures').innerText = this.captures[1];
        document.getElementById('white-captures').innerText = this.captures[2];

        // 訊息狀態
        let msg = "";
        if (this.isScoringPhase) {
            msg = "請點擊死子 (清理中)";
        } else {
            msg = this.turn === 1 ? "黑方落子 (請品茶)" : (this.mode === 'cpu' ? "茶友思考中..." : "白方落子");
        }
        const badge = document.getElementById('game-message');
        badge.innerText = msg;

        document.getElementById('player-black').classList.toggle('active', this.turn === 1);
        document.getElementById('player-white').classList.toggle('active', this.turn === 2);
    }

    undo() {
        if (this.isGameOver || this.isAiThinking || this.isScoringPhase) return;
        if(this.history.length === 0) return;
        const steps = this.mode === 'cpu' ? 2 : 1;
        if (this.mode === 'cpu' && this.history.length < 2) return;
        
        for(let i=0; i<steps; i++) {
             if(this.history.length > 0) {
                 const prev = this.history.pop();
                 this.board = prev.board;
                 this.turn = prev.turn;
                 this.captures = prev.captures;
                 this.lastMove = prev.lastMove;
                 this.koPosition = prev.koPosition;
             }
        }
        this.passCounter = 0;
        this.updateUI();
        this.draw();
    }

    playSound(color) {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            if (color === 1) {
                osc.type = 'sine'; osc.frequency.setValueAtTime(180, ctx.currentTime);
                gain.gain.setValueAtTime(0.7, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
            } else {
                osc.type = 'triangle'; osc.frequency.setValueAtTime(550, ctx.currentTime);
                gain.gain.setValueAtTime(0.4, ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.08);
            }
            osc.start(); osc.stop(ctx.currentTime + 0.2);
        } catch (e) {}
    }
}