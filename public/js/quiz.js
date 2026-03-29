// Quiz Game Controller - ties together game engine and quiz logic
class QuizGame {
  constructor(questions) {
    this.questions = questions.slice(0, 15); // Max 15 questions
    this.currentQuestion = 0;
    this.score = 0;
    this.streak = 0;
    this.bestStreak = 0;
    this.correctCount = 0;
    this.totalTime = 60;
    this.timeLeft = 60;
    this.timerInterval = null;
    this.gameEngine = null;
    this.isAnswering = false;
    this.results = [];
    this.targetQuestions = 10;
    this.boulderBaseDistance = 45;
  }

  start() {
    // Switch screens
    document.getElementById('upload-screen').classList.remove('active');
    document.getElementById('game-screen').classList.add('active');
    document.getElementById('gameover-screen').classList.remove('active');

    // Init 3D engine
    this.gameEngine = new GameEngine();
    this.gameEngine.init();
    this.gameEngine.setBoulderDistance(this.boulderBaseDistance);

    // Start timer
    this.startTimer();

    // Show first question after a short delay
    setTimeout(() => this.showQuestion(), 1500);

    // Update HUD
    this.updateHUD();
  }

  startTimer() {
    this.timerInterval = setInterval(() => {
      this.timeLeft -= 1;
      this.updateTimerDisplay();

      // Boulder approaches over time
      if (this.gameEngine) {
        this.gameEngine.moveBoulderCloser(0.3);
        // Camera shake increases as boulder gets closer
        if (this.gameEngine.boulderDistance < 15) {
          this.gameEngine.triggerShake(0.05 + (15 - this.gameEngine.boulderDistance) * 0.01);
        }
      }

      if (this.timeLeft <= 0) {
        this.endGame(false, 'Time\'s up! The boulder caught you!');
      }
    }, 1000);
  }

  updateTimerDisplay() {
    const timerText = document.getElementById('timer-text');
    const timerCircle = document.getElementById('timer-circle');
    const progress = this.timeLeft / this.totalTime;
    const dashoffset = 283 * (1 - progress);

    timerText.textContent = Math.max(0, this.timeLeft);
    timerCircle.style.strokeDashoffset = dashoffset;

    if (this.timeLeft <= 15) {
      timerCircle.classList.add('danger');
      timerText.classList.add('danger');
    } else {
      timerCircle.classList.remove('danger');
      timerText.classList.remove('danger');
    }
  }

  updateHUD() {
    document.getElementById('hud-score').textContent = this.score;
    document.getElementById('hud-streak').textContent = this.streak;
    document.getElementById('hud-question').textContent =
      `${this.currentQuestion + 1}/${Math.min(this.targetQuestions, this.questions.length)}`;

    // Danger bar
    const dangerFill = document.getElementById('danger-fill');
    if (this.gameEngine) {
      const danger = (1 - (this.gameEngine.boulderDistance - 5) / 40) * 100;
      dangerFill.style.width = Math.min(100, Math.max(5, danger)) + '%';
    }
  }

  showQuestion() {
    if (this.currentQuestion >= this.questions.length ||
        this.currentQuestion >= this.targetQuestions) {
      this.endGame(true, 'You escaped the boulder!');
      return;
    }

    const q = this.questions[this.currentQuestion];
    const panel = document.getElementById('question-panel');
    const questionText = document.getElementById('question-text');
    const optionsContainer = document.getElementById('options-container');

    questionText.textContent = q.question;
    optionsContainer.innerHTML = '';

    q.options.forEach((opt, idx) => {
      const btn = document.createElement('button');
      btn.className = 'option-btn';
      btn.textContent = opt;
      btn.addEventListener('click', () => this.answerQuestion(idx));
      optionsContainer.appendChild(btn);
    });

    panel.classList.remove('hidden');
    this.isAnswering = true;
    this.updateHUD();
  }

  answerQuestion(selectedIdx) {
    if (!this.isAnswering) return;
    this.isAnswering = false;

    const q = this.questions[this.currentQuestion];
    const correct = selectedIdx === q.correct;
    const optionBtns = document.querySelectorAll('.option-btn');

    // Highlight answers
    optionBtns.forEach((btn, idx) => {
      btn.classList.add('disabled');
      if (idx === q.correct) btn.classList.add('correct');
      if (idx === selectedIdx && !correct) btn.classList.add('wrong');
    });

    // Save result
    this.results.push({
      question: q.question,
      selected: q.options[selectedIdx],
      correct: q.options[q.correct],
      isCorrect: correct,
      explanation: q.explanation
    });

    if (correct) {
      this.correctCount++;
      this.streak++;
      if (this.streak > this.bestStreak) this.bestStreak = this.streak;

      // Score: base + streak bonus + time bonus
      const streakBonus = Math.min(this.streak * 50, 250);
      const timeBonus = Math.floor(this.timeLeft / this.totalTime * 100);
      this.score += 100 + streakBonus + timeBonus;

      // Push boulder back!
      if (this.gameEngine) {
        this.gameEngine.pushBoulderBack(8);
        this.gameEngine.setSpeed(0.1); // Slow down briefly
      }

      this.showFeedback(true, '+' + (100 + streakBonus + timeBonus));

    } else {
      this.streak = 0;

      // Boulder charges forward!
      if (this.gameEngine) {
        this.gameEngine.moveBoulderCloser(8);
        this.gameEngine.triggerShake(0.4);
        this.gameEngine.setSpeed(0.25); // Speed up
      }

      // Lose time on wrong answer
      this.timeLeft = Math.max(0, this.timeLeft - 5);

      this.showFeedback(false, 'WRONG! -5s');
    }

    this.updateHUD();

    // Next question after delay
    setTimeout(() => {
      if (this.gameEngine) this.gameEngine.setSpeed(0.15);
      document.getElementById('question-panel').classList.add('hidden');

      // Check if boulder caught player
      if (this.gameEngine && this.gameEngine.boulderDistance <= this.gameEngine.minBoulderDistance) {
        this.endGame(false, 'The boulder crushed you!');
        return;
      }

      this.currentQuestion++;
      setTimeout(() => this.showQuestion(), 800);
    }, 1200);
  }

  showFeedback(correct, text) {
    const overlay = document.getElementById('feedback-overlay');
    const content = document.getElementById('feedback-content');

    content.textContent = text;
    content.className = 'feedback-content ' + (correct ? 'correct' : 'wrong');
    overlay.classList.remove('hidden');

    setTimeout(() => overlay.classList.add('hidden'), 1000);
  }

  endGame(won, message) {
    clearInterval(this.timerInterval);

    if (this.gameEngine) {
      this.gameEngine.running = false;
    }

    // Hide game elements
    document.getElementById('question-panel').classList.add('hidden');

    // Switch to game over screen
    setTimeout(() => {
      document.getElementById('game-screen').classList.remove('active');
      document.getElementById('gameover-screen').classList.add('active');

      const title = document.getElementById('gameover-title');
      title.textContent = won ? 'YOU ESCAPED!' : 'GAME OVER';
      title.className = won ? 'win' : 'lose';

      document.getElementById('final-score').textContent = this.score;
      document.getElementById('final-correct').textContent =
        `${this.correctCount}/${this.currentQuestion}`;
      document.getElementById('final-streak').textContent = this.bestStreak;
      document.getElementById('final-time').textContent =
        `${this.totalTime - this.timeLeft}s`;

      // Review
      const reviewContainer = document.getElementById('gameover-review');
      reviewContainer.innerHTML = '<h3 style="color: var(--gold); font-family: Bebas Neue; letter-spacing: 2px; margin-bottom: 12px;">QUESTION REVIEW</h3>';

      this.results.forEach((r, i) => {
        const div = document.createElement('div');
        div.className = 'review-item ' + (r.isCorrect ? 'correct' : 'wrong');
        div.innerHTML = `
          <div class="review-q">${i + 1}. ${r.question}</div>
          <div class="review-a">
            ${r.isCorrect ? '✅ Correct' : `❌ Your answer: ${r.selected}<br>✅ Correct: ${r.correct}`}
            ${r.explanation ? `<br>💡 ${r.explanation}` : ''}
          </div>
        `;
        reviewContainer.appendChild(div);
      });
    }, 1000);
  }

  cleanup() {
    clearInterval(this.timerInterval);
    if (this.gameEngine) {
      this.gameEngine.destroy();
    }
  }
}

// Global state
let currentGame = null;
let currentQuestions = null;

// Called by upload.js when questions are ready
window.startGame = function(questions) {
  currentQuestions = questions;
  if (currentGame) currentGame.cleanup();
  currentGame = new QuizGame(questions);
  currentGame.start();
};

// Retry button
document.getElementById('retry-btn').addEventListener('click', () => {
  if (currentQuestions) {
    document.getElementById('gameover-screen').classList.remove('active');
    if (currentGame) currentGame.cleanup();
    currentGame = new QuizGame(currentQuestions);
    currentGame.start();
  }
});

// New content button
document.getElementById('new-btn').addEventListener('click', () => {
  if (currentGame) currentGame.cleanup();
  document.getElementById('gameover-screen').classList.remove('active');
  document.getElementById('game-screen').classList.remove('active');
  document.getElementById('upload-screen').classList.add('active');
});
