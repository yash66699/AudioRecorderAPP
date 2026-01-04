// ============================================================
// WAV ENCODER - Creates proper uncompressed PCM WAV files
// ============================================================
class WAVEncoder {
    static encodeWAV(audioData, sampleRate, numChannels) {
        const numberOfSamples = audioData[0].length;
        const fmt = {
            chunkId: [0x66, 0x6d, 0x74, 0x20], // 'fmt '
            chunkSize: 16,
            audioFormat: 1, // PCM
            numChannels: numChannels,
            sampleRate: sampleRate,
            byteRate: sampleRate * numChannels * 2, // sampleRate * numChannels * bytesPerSample
            blockAlign: numChannels * 2, // numChannels * bytesPerSample
            bitsPerSample: 16
        };

        const data = {
            chunkId: [0x64, 0x61, 0x74, 0x61], // 'data'
            chunkSize: numberOfSamples * numChannels * 2
        };

        const fileSize = 36 + data.chunkSize;

        // Create WAV file buffer
        const wavBuffer = new ArrayBuffer(44 + data.chunkSize);
        const view = new DataView(wavBuffer);

        // RIFF header
        const setUint32 = (offset, value, littleEndian = true) => 
            view.setUint32(offset, value, littleEndian);
        const setUint16 = (offset, value, littleEndian = true) => 
            view.setUint16(offset, value, littleEndian);
        const setUint8 = (offset, value) => view.setUint8(offset, value);

        let offset = 0;

        // 'RIFF' chunk descriptor
        setUint8(offset, 0x52); // 'R'
        setUint8(offset + 1, 0x49); // 'I'
        setUint8(offset + 2, 0x46); // 'F'
        setUint8(offset + 3, 0x46); // 'F'
        offset += 4;

        setUint32(offset, fileSize); // File size
        offset += 4;

        setUint8(offset, 0x57); // 'W'
        setUint8(offset + 1, 0x41); // 'A'
        setUint8(offset + 2, 0x56); // 'V'
        setUint8(offset + 3, 0x45); // 'E'
        offset += 4;

        // 'fmt ' sub-chunk
        setUint8(offset, 0x66); // 'f'
        setUint8(offset + 1, 0x6d); // 'm'
        setUint8(offset + 2, 0x74); // 't'
        setUint8(offset + 3, 0x20); // ' '
        offset += 4;

        setUint32(offset, fmt.chunkSize);
        offset += 4;
        setUint16(offset, fmt.audioFormat);
        offset += 2;
        setUint16(offset, fmt.numChannels);
        offset += 2;
        setUint32(offset, fmt.sampleRate);
        offset += 4;
        setUint32(offset, fmt.byteRate);
        offset += 4;
        setUint16(offset, fmt.blockAlign);
        offset += 2;
        setUint16(offset, fmt.bitsPerSample);
        offset += 2;

        // 'data' sub-chunk
        setUint8(offset, 0x64); // 'd'
        setUint8(offset + 1, 0x61); // 'a'
        setUint8(offset + 2, 0x74); // 't'
        setUint8(offset + 3, 0x61); // 'a'
        offset += 4;

        setUint32(offset, data.chunkSize);
        offset += 4;

        // Interleave audio data (L, R, L, R, ...)
        let index = 0;
        const volume = 0.8; // Prevent clipping
        for (let i = 0; i < numberOfSamples; i++) {
            for (let channel = 0; channel < numChannels; channel++) {
                let sample = Math.max(-1, Math.min(1, audioData[channel][i])) * volume;
                sample = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
                view.setInt16(offset + index, sample, true);
                index += 2;
            }
        }

        return new Blob([wavBuffer], { type: 'audio/wav' });
    }
}

// ============================================================
// UPDATED AUDIO RECORDER WITH DIRECT WAV ENCODING
// ============================================================
class AudioRecorder {
    constructor() {
        this.mediaRecorder = null;
        this.audioChunks = [];
        this.audioContext = null;
        this.stream = null;
        this.recordings = [];
        this.isRecording = false;
        this.countdownInterval = null;
        this.driveManager = new GoogleDriveManager();
        this.dualMicManager = new DualMicrophoneManager();
        this.stereoChannelCount = 0;
        this.usingStereoMics = false;
        
        // For direct audio capture and WAV encoding
        this.analyserNode = null;
        this.scriptProcessorNode = null;
        this.audioBuffers = [[], []]; // Left and Right channel buffers
        this.sampleRate = 44100;

        document.addEventListener('DOMContentLoaded', () => this.initialize());
    }

    initialize() {
        // UI Elements (same as before)
        this.directionSelect = document.getElementById('direction-select');
        this.durationSelect = document.getElementById('duration-select');
        this.distanceSelect = document.getElementById('distance-select');
        this.recordButton = document.getElementById('record-button');
        this.recordButtonText = document.getElementById('record-button-text');
        this.statusMessage = document.getElementById('status-message');
        this.countdownTimer = document.getElementById('countdown-timer');
        this.micStatus = document.getElementById('mic-status-text');
        this.micIndicator = document.querySelector('.mic-indicator');
        this.recordingsList = document.getElementById('recordings-list');
        this.fileCount = document.getElementById('file-count');
        this.uploadAllButton = document.getElementById('upload-all-button');
        this.uploadButtonText = document.getElementById('upload-button-text');
        this.clearAllButton = document.getElementById('clear-all-button');
        this.playbackAudio = document.getElementById('playback-audio');
        this.googleSigninBtn = document.getElementById('google-signin-btn');
        this.googleSignoutBtn = document.getElementById('google-signout-btn');
        this.authIndicator = document.getElementById('auth-indicator');
        this.authStatusText = document.getElementById('auth-status-text');
        this.uploadProgressSection = document.getElementById('upload-progress-section');
        this.uploadSummary = document.getElementById('upload-summary');
        this.uploadList = document.getElementById('upload-list');
        this.toggleSetupBtn = document.getElementById('toggle-setup');
        this.setupContent = document.getElementById('setup-content');
        this.selectFolderButton = document.getElementById('select-folder-button');
        this.selectedFolderNameElement = document.getElementById('selected-folder-name');

        // Bind events
        this.recordButton.onclick = () => this.handleRecordClick();
        this.clearAllButton.onclick = () => this.clearAllRecordings();
        this.uploadAllButton.onclick = () => this.uploadAllToDrive();
        if (this.googleSigninBtn) this.googleSigninBtn.onclick = () => this.signInToGoogleDrive();
        if (this.googleSignoutBtn) this.googleSignoutBtn.onclick = () => this.signOutFromGoogleDrive();
        this.toggleSetupBtn.onclick = () => this.toggleSetupInstructions();

        if (this.selectFolderButton) {
            this.selectFolderButton.disabled = true;
            this.selectFolderButton.onclick = (e) => {
                e.preventDefault();
                this.createPicker();
            };
        }

        // Initial states
        this.updateMicrophoneStatus('', 'Initializing audio system...');
        this.recordButton.disabled = true;
        this.clearAllButton.disabled = true;
        this.uploadAllButton.disabled = true;
        if (this.selectFolderButton) this.selectFolderButton.disabled = true;
        this.updateFileCount();
        this.updateAuthenticationStatus(false);

        setTimeout(() => this.requestMicrophoneAccess(), 500);
    }

    updateAuthenticationStatus(isAuthenticated) {
        this.driveManager.isAuthenticated = isAuthenticated;
        if (isAuthenticated) {
            this.authIndicator.classList.add('connected');
            this.authStatusText.textContent = 'Connected to Google Drive';
            this.googleSigninBtn.classList.add('hidden');
            this.googleSignoutBtn.classList.remove('hidden');
            if (this.uploadAllButton && this.recordings.length > 0) this.uploadAllButton.disabled = false;
            if (this.selectFolderButton) this.selectFolderButton.disabled = false;
        } else {
            this.authIndicator.classList.remove('connected');
            this.authStatusText.textContent = 'Not connected to Google Drive';
            this.googleSigninBtn.classList.remove('hidden');
            this.googleSignoutBtn.classList.add('hidden');
            if (this.uploadAllButton) this.uploadAllButton.disabled = true;
            if (this.selectFolderButton) {
                this.selectFolderButton.disabled = true;
                if (this.selectedFolderNameElement) this.selectedFolderNameElement.textContent = '';
                selectedFolderId = null;
            }
        }
    }

    async signInToGoogleDrive() {
        try {
            this.googleSigninBtn.classList.add('loading');
            await this.driveManager.authenticate();
            this.showSuccess('Connected to Google Drive!');
        } catch (error) {
            this.showError('Failed to connect: ' + error.message);
        } finally {
            this.googleSigninBtn.classList.remove('loading');
        }
    }

    signOutFromGoogleDrive() {
        this.driveManager.signOut();
        this.updateAuthenticationStatus(false);
        this.showSuccess('Signed out from Google Drive');
    }

    toggleSetupInstructions() {
        const isHidden = this.setupContent.classList.contains('hidden');
        if (isHidden) {
            this.setupContent.classList.remove('hidden');
            this.toggleSetupBtn.textContent = 'Hide Setup';
        } else {
            this.setupContent.classList.add('hidden');
            this.toggleSetupBtn.textContent = 'Show Setup';
        }
    }

    async requestMicrophoneAccess() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        this.updateMicrophoneStatus('error', 'Microphone not supported');
        return;
    }

    try {
        // Step 1: Initialize audio context first
        this.initializeAudioContext();
        this.sampleRate = this.audioContext.sampleRate;
        console.log(`Sample rate: ${this.sampleRate} Hz`);

        // Step 2: REQUEST PERMISSION FIRST - get a basic mono stream just to grant permission
        console.log('Requesting microphone permission...');
        const permissionStream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        });

        // Permission granted! Now we can enumerate devices
        console.log('✅ Microphone permission granted');

        // Step 3: Enumerate all audio devices NOW that permission is granted
        const devices = await navigator.mediaDevices.enumerateDevices();
        const audioInputs = devices.filter(device => device.kind === 'audioinput');
        
        console.log(`🎙️ Found ${audioInputs.length} audio input devices:`);
        audioInputs.forEach((device, index) => {
            console.log(`  ${index}: ${device.label || `Microphone ${index + 1}`}`);
        });

        // Step 4: Try dual microphone mode if we have 2+ devices
        if (audioInputs.length >= 2) {
            console.log('Attempting dual microphone mode...');
            const dualMicSuccess = await this.dualMicManager.initialize(this.audioContext);

            if (dualMicSuccess) {
                this.stream = this.dualMicManager.getStream();
                this.stereoChannelCount = 2;
                this.usingStereoMics = true;
                this.updateMicrophoneStatus('active', '🎙️🎙️ Dual Microphones (True Stereo WAV)');
                
                // Stop the permission stream since we're using dual mic streams
                permissionStream.getTracks().forEach(track => track.stop());
                
                this.recordButton.disabled = false;
                this.statusMessage.textContent = 'Ready to record';
                return;
            }
        }

        // Step 5: Fallback - use the permission stream for single mic stereo
        console.log('Using single microphone with stereo request...');
        this.stream = permissionStream;

        const track = this.stream.getAudioTracks()[0];
        if (track) {
            const settings = track.getSettings();
            this.stereoChannelCount = settings.channelCount || 1;
            console.log('Microphone Settings:', settings);
            
            if (this.stereoChannelCount === 2) {
                console.log('✅ Stereo recording ACTIVE (2 channels from single device)');
                this.updateMicrophoneStatus('active', '🎤 Single Microphone (Stereo WAV)');
            } else {
                console.warn('⚠️ System returned mono stream');
                this.updateMicrophoneStatus('active', '🔊 Mono Mode (Check if your device supports stereo)');
            }
        }

        this.recordButton.disabled = false;
        this.statusMessage.textContent = 'Ready to record';

    } catch (error) {
        console.error('❌ Microphone Access Error:', error);
        
        if (error.name === 'NotAllowedError') {
            this.updateMicrophoneStatus('error', 'Microphone permission denied - please enable in settings');
        } else if (error.name === 'NotFoundError') {
            this.updateMicrophoneStatus('error', 'No microphone found on this device');
        } else {
            this.updateMicrophoneStatus('error', `Microphone error: ${error.message}`);
        }
        
        this.recordButton.disabled = true;
        this.statusMessage.textContent = 'Microphone access required';
    }
}


    initializeAudioContext() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext && !this.audioContext) {
            this.audioContext = new AudioContext();
        }
    }

    updateMicrophoneStatus(status, message) {
        this.micStatus.textContent = message;
        this.micIndicator.className = `mic-indicator ${status}`;
    }

    async handleRecordClick() {
        if (this.isRecording) this.stopRecording();
        else await this.startRecording();
    }

    async startRecording() {
        if (!this.stream) return this.showError('No mic access');

        try {
            this.isRecording = true;
            this.audioBuffers = [[], []]; // Reset buffers
            this.recordButton.disabled = true;
            this.recordButton.classList.add('recording');
            this.recordButtonText.textContent = 'Preparing...';
            this.statusMessage.textContent = 'Playing beep...';
            this.statusMessage.className = 'status-message recording';

            await this.playBeep();

            // Create audio nodes for direct capture
            const source = this.audioContext.createMediaStreamSource(this.stream);
            
            // ScriptProcessorNode to capture raw audio (deprecated but widely supported)
            // Alternative: AudioWorklet (more complex but future-proof)
            this.scriptProcessorNode = this.audioContext.createScriptProcessor(4096, 2, 2);

            this.scriptProcessorNode.onaudioprocess = (event) => {
                const leftData = event.inputBuffer.getChannelData(0);
                const rightData = event.inputBuffer.getChannelData(1);

                // Store samples as Float32
                this.audioBuffers[0].push(...leftData);
                this.audioBuffers[1].push(...rightData);
            };

            // Connect source → processor
            source.connect(this.scriptProcessorNode);
            this.scriptProcessorNode.connect(this.audioContext.destination);

            this.recordButtonText.textContent = 'Recording...';
            this.statusMessage.textContent = 'Recording in progress...';
            this.countdownTimer.classList.remove('hidden');

            const duration = parseInt(this.durationSelect.value || '2');
            this.startCountdown(duration);

            setTimeout(() => {
                if (this.isRecording) this.stopRecording();
            }, duration * 1000);

        } catch (e) {
            this.resetRecordingState();
            this.showError('Recording failed: ' + e.message);
        }
    }

    stopRecording() {
        this.isRecording = false;
        clearInterval(this.countdownInterval);
        
        // Disconnect audio nodes
        if (this.scriptProcessorNode) {
            this.scriptProcessorNode.disconnect();
        }

        this.recordButtonText.textContent = 'Processing...';
        this.statusMessage.textContent = 'Encoding WAV file...';
        this.statusMessage.className = 'status-message processing';
        this.countdownTimer.classList.add('hidden');

        // Process and encode to WAV
        setTimeout(() => this.processRecording(), 100);
    }

    async playBeep() {
        return new Promise((resolve) => {
            if (!this.audioContext) {
                setTimeout(resolve, 200);
                return;
            }

            if (this.audioContext.state === 'suspended') this.audioContext.resume();

            try {
                const oscillator = this.audioContext.createOscillator();
                const gainNode = this.audioContext.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(this.audioContext.destination);
                oscillator.frequency.setValueAtTime(440, this.audioContext.currentTime);
                oscillator.type = 'sine';
                gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);
                oscillator.start();
                oscillator.stop(this.audioContext.currentTime + 0.2);
                oscillator.onended = resolve;
            } catch {
                setTimeout(resolve, 200);
            }
        });
    }

    startCountdown(duration) {
        let remaining = duration;
        const updateTimer = () => {
            const m = Math.floor(remaining / 60);
            const s = remaining % 60;
            this.countdownTimer.textContent = `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
            remaining--;
            if (remaining < 0) clearInterval(this.countdownInterval);
        };
        updateTimer();
        this.countdownInterval = setInterval(updateTimer, 1000);
    }

    processRecording() {
        console.log(`Encoding WAV: ${this.audioBuffers[0].length} samples, 2 channels, ${this.sampleRate} Hz`);

        // Encode to WAV
        const audioBlob = WAVEncoder.encodeWAV(this.audioBuffers, this.sampleRate, 2);
        const filename = this.generateFilename();

        const recording = {
            id: Date.now(),
            filename,
            blob: audioBlob,
            url: URL.createObjectURL(audioBlob),
            direction: this.directionSelect.value || '0',
            distance: this.distanceSelect.value || '1ft',
            duration: this.durationSelect.value || '2',
            timestamp: new Date().toLocaleString(),
            size: audioBlob.size,
            cached: !navigator.onLine,
            uploaded: false,
            driveUrl: null,
            channels: 2,
            stereoMics: this.usingStereoMics,
            encoding: 'PCM WAV'
        };

        this.recordings.push(recording);
        this.addRecordingToList(recording);
        this.updateFileCount();
        this.resetRecordingState();
        
        const recordingType = this.usingStereoMics ? 'Dual Mic WAV' : 'Stereo WAV';
        this.showSuccess(navigator.onLine ? `Recording saved (${recordingType})!` : `Saved offline (${recordingType})!`);
        
        this.clearAllButton.disabled = false;
        if (this.driveManager.isAuthenticated) this.uploadAllButton.disabled = false;
    }

    generateFilename() {
        const d = (this.directionSelect.value || '0') + 'deg';
        const dist = (this.distanceSelect.value || '1ft');
        const dur = (this.durationSelect.value || '2') + 'sec';
        const now = new Date();
        const date = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
        const time = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
        return `${d}_${dist}_${dur}_${date}_${time}.wav`;
    }

    addRecordingToList(rec) {
        const emptyState = this.recordingsList.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const item = document.createElement('div');
        item.className = `recording-item${rec.uploaded ? ' uploaded' : ''}`;
        item.setAttribute('data-recording-id', rec.id);

        const channelInfo = '🎧 Stereo';
        const micInfo = rec.stereoMics ? '🎙️🎙️ Dual Mic' : '🎤 Single Mic';
        const encodingInfo = `📊 ${rec.encoding}`;

        item.innerHTML = `
            <div class="recording-info">
                <div class="recording-filename">${rec.filename}${rec.cached ? ' 📱' : ''}${rec.uploaded ? ' ✅' : ''}</div>
                <div class="recording-details">
                    <span>Direction: ${rec.direction}°</span>
                    <span>Distance: ${rec.distance}</span>
                    <span>Duration: ${rec.duration}s</span>
                    <span>Size: ${this.formatFileSize(rec.size)}</span>
                    <span class="channel-badge">${channelInfo}</span>
                    <span class="mic-badge">${micInfo}</span>
                    <span class="encoding-badge">${encodingInfo}</span>
                    ${rec.cached ? '<span class="pwa-status offline">Offline</span>' : '<span class="pwa-status online">Online</span>'}
                    ${rec.uploaded && rec.driveUrl ? `<a href="${rec.driveUrl}" target="_blank" class="drive-link">View in Drive</a>` : ''}
                </div>
            </div>
            <div class="recording-actions">
                <button class="btn btn--sm btn--secondary play-btn">Play</button>
                <button class="btn btn--sm btn--outline download-btn">Download</button>
                <button class="btn btn--sm btn--outline delete-btn">Delete</button>
            </div>
        `;

        item.querySelector('.play-btn').onclick = () => this.playRecording(rec.id);
        item.querySelector('.download-btn').onclick = () => this.downloadRecording(rec.id);
        item.querySelector('.delete-btn').onclick = () => this.deleteRecording(rec.id);

        this.recordingsList.appendChild(item);
    }

    playRecording(id) {
        const rec = this.recordings.find(r => r.id === id);
        if (rec && this.playbackAudio) {
            this.playbackAudio.src = rec.url;
            this.playbackAudio.play()
                .then(() => this.showSuccess('Playing recording...'))
                .catch(e => this.showError('Playback failed: ' + e.message));
        }
    }

    downloadRecording(id) {
        const rec = this.recordings.find(r => r.id === id);
        if (rec) {
            const a = document.createElement('a');
            a.href = rec.url;
            a.download = rec.filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            this.showSuccess('Download started!');
        }
    }

    deleteRecording(id) {
        if (!confirm('Delete this recording?')) return;

        const idx = this.recordings.findIndex(r => r.id === id);
        if (idx !== -1) {
            URL.revokeObjectURL(this.recordings[idx].url);
            this.recordings.splice(idx, 1);

            const el = document.querySelector(`[data-recording-id="${id}"]`);
            if (el) el.remove();

            if (this.recordings.length === 0) {
                this.showEmptyState();
                this.clearAllButton.disabled = true;
                this.uploadAllButton.disabled = true;
            }

            this.updateFileCount();
            this.showSuccess('Recording deleted!');
        }
    }

    clearAllRecordings() {
        if (this.recordings.length === 0) return alert('No recordings to clear.');
        if (!confirm(`Delete all ${this.recordings.length} recording(s)?`)) return;

        this.recordings.forEach(r => URL.revokeObjectURL(r.url));
        this.recordings = [];
        this.showEmptyState();
        this.updateFileCount();
        this.clearAllButton.disabled = true;
        this.uploadAllButton.disabled = true;
        this.showSuccess('All recordings cleared!');
    }

    async uploadAllToDrive() {
        const filesToUpload = this.recordings.filter(r => !r.uploaded);
        if (filesToUpload.length === 0) return alert('No new recordings to upload.');
        if (!navigator.onLine) return alert('Upload requires internet connection.');
        if (!this.driveManager.isAuthenticated) return alert('Please sign in to Google Drive first.');

        if (this.uploadProgressSection) this.uploadProgressSection.classList.remove('hidden');
        this.uploadAllButton.disabled = true;
        this.uploadAllButton.classList.add('loading');
        this.uploadButtonText.textContent = 'Uploading...';

        await this.driveManager.uploadMultipleFiles(
            filesToUpload,
            (i, total, status, filename, progress = 0) => this.updateUploadProgress(i, total, status, filename, progress),
            (file, success) => {
                if (success) this.updateRecordingInList(file);
            }
        );

        this.uploadSummary.textContent = `Upload complete`;
        this.showSuccess(`Uploaded ${filesToUpload.length} file(s) to Google Drive!`);
        this.uploadAllButton.disabled = false;
        this.uploadAllButton.classList.remove('loading');
        this.uploadButtonText.textContent = 'Upload All to Drive';
        setTimeout(() => this.uploadProgressSection.classList.add('hidden'), 5000);
    }

    updateUploadProgress(index, total, status, filename, progress = 0) {
        if (!this.uploadList || !this.uploadSummary) return;

        this.uploadSummary.textContent = `Uploading ${index + 1} of ${total}: ${filename}`;

        let uiItem = this.uploadList.querySelector(`[data-filename="${filename}"]`);
        if (!uiItem) {
            uiItem = document.createElement('div');
            uiItem.className = 'upload-item';
            uiItem.setAttribute('data-filename', filename);
            uiItem.innerHTML = `
                <div class="upload-item-info">
                    <div class="upload-filename">${filename}</div>
                    <div class="upload-status">Preparing...</div>
                </div>
                <div class="upload-progress"><div class="upload-progress-bar"></div></div>
            `;
            this.uploadList.appendChild(uiItem);
        }

        const statusEl = uiItem.querySelector('.upload-status');
        const progressBar = uiItem.querySelector('.upload-progress-bar');

        if (statusEl) {
            statusEl.className = `upload-status ${status}`;
            if (status === 'uploading') statusEl.textContent = `Uploading... ${Math.round(progress)}%`;
            else if (status === 'success') statusEl.textContent = 'Uploaded successfully';
            else if (status === 'error') statusEl.textContent = 'Upload failed';
        }

        if (progressBar) progressBar.style.width = `${progress}%`;
    }

    updateRecordingInList(recording) {
        const item = document.querySelector(`[data-recording-id="${recording.id}"]`);
        if (item) {
            item.classList.add('uploaded');
            const filename = item.querySelector('.recording-filename');
            if (filename && !filename.textContent.includes('✅')) filename.textContent += ' ✅';

            const details = item.querySelector('.recording-details');
            if (details && recording.driveUrl && !details.querySelector('.drive-link')) {
                const a = document.createElement('a');
                a.href = recording.driveUrl;
                a.target = '_blank';
                a.className = 'drive-link';
                a.textContent = 'View in Drive';
                details.appendChild(a);
            }
        }
    }

    showEmptyState() {
        this.recordingsList.innerHTML = `
            <div class="empty-state">
                <div class="empty-icon">📁</div>
                <p>No recordings yet. Start recording to see your files here.</p>
                <p class="pwa-info">📄 Works offline • 📱 Install as app • ☁️ Google Drive sync • 🎙️🎙️ Dual Mic Stereo • 📊 PCM WAV</p>
            </div>
        `;
    }

    updateFileCount() {
        const count = this.recordings.length;
        const uploadedCount = this.recordings.filter(r => r.uploaded).length;
        const offlineCount = this.recordings.filter(r => r.cached).length;
        const dualMicCount = this.recordings.filter(r => r.stereoMics).length;

        let text = `${count} file${count !== 1 ? 's' : ''}`;
        if (uploadedCount > 0) text += ` (${uploadedCount} uploaded)`;
        if (offlineCount > 0) text += ` (${offlineCount} offline)`;
        if (dualMicCount > 0) text += ` 🎙️🎙️${dualMicCount} dual-mic`;

        this.fileCount.textContent = text;
    }

    formatFileSize(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    resetRecordingState() {
        this.isRecording = false;
        this.recordButton.disabled = false;
        this.recordButton.classList.remove('recording');
        this.recordButtonText.textContent = 'Start Recording';
        this.statusMessage.textContent = 'Ready to record';
        this.statusMessage.className = 'status-message';
        this.countdownTimer.classList.add('hidden');
    }

    showSuccess(msg) {
        this.statusMessage.textContent = msg;
        this.statusMessage.className = 'status-message success';
        setTimeout(() => {
            if (!this.isRecording) {
                this.statusMessage.textContent = 'Ready to record';
                this.statusMessage.className = 'status-message';
            }
        }, 2000);
    }

    showError(msg) {
        this.statusMessage.textContent = msg;
        this.statusMessage.className = 'status-message error';
        setTimeout(() => {
            if (!this.isRecording) {
                this.statusMessage.textContent = 'Ready to record';
                this.statusMessage.className = 'status-message';
            }
        }, 3000);
    }

    createPicker() {
        if (!accessToken) {
            alert('Please sign in first to select a folder.');
            return;
        }

        const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
            .setSelectFolderEnabled(true)
            .setMimeTypes('application/vnd.google-apps.folder');

        const picker = new google.picker.PickerBuilder()
            .addView(view)
            .setOAuthToken(accessToken)
            .setDeveloperKey(GOOGLE_CONFIG.API_KEY)
            .setCallback(this.pickerCallback.bind(this))
            .setSelectableMimeTypes('application/vnd.google-apps.folder')
            .build();

        picker.setVisible(true);
    }

    pickerCallback(data) {
        if (data.action === google.picker.Action.PICKED) {
            const folder = data.docs[0];
            selectedFolderId = folder.id;
            if (this.selectedFolderNameElement) {
                this.selectedFolderNameElement.textContent = folder.name;
            }
            alert(`Selected Folder: ${folder.name}`);
        }
    }
}

window.audioRecorder = new AudioRecorder();

