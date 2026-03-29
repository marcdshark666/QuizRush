// Upload screen logic
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');
const dropZone = document.getElementById('drop-zone');
const fileInput = document.getElementById('file-input');
const fileNameDisplay = document.getElementById('file-name');
const startBtn = document.getElementById('start-btn');
const btnText = startBtn.querySelector('.btn-text');
const btnLoader = startBtn.querySelector('.btn-loader');

let selectedFile = null;

// Tab switching
tabBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    tabBtns.forEach(b => b.classList.remove('active'));
    tabContents.forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('tab-' + btn.dataset.tab).classList.add('active');
  });
});

// File drop zone
dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) {
    selectedFile = e.dataTransfer.files[0];
    showFileName(selectedFile.name);
  }
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) {
    selectedFile = fileInput.files[0];
    showFileName(selectedFile.name);
  }
});

function showFileName(name) {
  fileNameDisplay.textContent = '✅ ' + name;
  fileNameDisplay.classList.add('show');
}

// Start button
startBtn.addEventListener('click', async () => {
  const activeTab = document.querySelector('.tab-btn.active').dataset.tab;
  let body;
  let isFormData = false;

  if (activeTab === 'file') {
    if (!selectedFile) return alert('Please select a file first!');
    const formData = new FormData();
    formData.append('file', selectedFile);
    body = formData;
    isFormData = true;
  } else if (activeTab === 'text') {
    const text = document.getElementById('text-input').value.trim();
    if (text.length < 50) return alert('Please enter at least 50 characters of text.');
    body = JSON.stringify({ text });
  } else if (activeTab === 'url') {
    const url = document.getElementById('url-input').value.trim();
    if (!url) return alert('Please enter a URL.');
    body = JSON.stringify({ url });
  }

  // Show loading state
  startBtn.disabled = true;
  btnText.style.display = 'none';
  btnLoader.style.display = 'inline';

  try {
    const endpoint = activeTab === 'file' ? '/api/upload' : (activeTab === 'text' ? '/api/text' : '/api/upload');
    const headers = isFormData ? {} : { 'Content-Type': 'application/json' };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body
    });

    const data = await response.json();

    if (!response.ok) throw new Error(data.error || 'Server error');
    if (!data.questions || data.questions.length < 5) throw new Error('Not enough questions generated.');

    // Start the game with questions
    window.startGame(data.questions);

  } catch (err) {
    alert('Error: ' + err.message);
  } finally {
    startBtn.disabled = false;
    btnText.style.display = 'inline';
    btnLoader.style.display = 'none';
  }
});
