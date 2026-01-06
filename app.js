// ============================================================
// GOOGLE DRIVE API CONFIGURATION
// ============================================================
const GOOGLE_CONFIG = {
    CLIENT_ID: '561390564463-32380lelkhlm9a9g7r631mhbv6hln29s.apps.googleusercontent.com',
    API_KEY: 'AIzaSyAfmO2Q-8-hGwAylaF2lRo_r7kB4vHT1aA',
    DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    SCOPES: 'https://www.googleapis.com/auth/drive.file'
};

let gapi, google;
let isGapiLoaded = false;
let isGisLoaded = false;
let tokenClient;
let accessToken = null;
let selectedFolderId = null;

window.gapiLoaded = () => {
    gapi = window.gapi;
    gapi.load('client:auth2', async () => {
        await initializeGapiClient();
        gapi.load('picker', () => {
            console.log('Picker API loaded');
        });
    });
};

window.gisLoaded = () => {
    google = window.google;
    isGisLoaded = true;
    maybeEnableButtons();
};

async function initializeGapiClient() {
    await gapi.client.init({
        apiKey: GOOGLE_CONFIG.API_KEY,
        discoveryDocs: [GOOGLE_CONFIG.DISCOVERY_DOC],
    });
    isGapiLoaded = true;
    maybeEnableButtons();
}

function maybeEnableButtons() {
    if (isGapiLoaded && isGisLoaded) {
        tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: GOOGLE_CONFIG.CLIENT_ID,
            scope: GOOGLE_CONFIG.SCOPES,
            callback: (resp) => {
                if (resp.error) {
                    console.error('Error fetching access token:', resp.error);
                    window.audioRecorder && window.audioRecorder.updateAuthenticationStatus(false);
                    return;
                }
                accessToken = resp.access_token;
                console.log('Access token received');
                if (window.audioRecorder) {
                    window.audioRecorder.updateAuthenticationStatus(true);
                }
            }
        });
    }
}

// ============================================================
// GOOGLE DRIVE MANAGER
// ============================================================
class GoogleDriveManager {
    constructor() {
        this.isAuthenticated = false;
        this.accessToken = null;
    }

    async authenticate() {
        if (!isGapiLoaded || !isGisLoaded) {
            throw new Error('Google APIs not loaded yet. Please wait.');
        }

        return new Promise((resolve, reject) => {
            try {
                if (gapi.client.getToken() === null) {
                    tokenClient.requestAccessToken({ prompt: 'consent' });
                } else {
                    tokenClient.requestAccessToken({ prompt: '' });
                }
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    }

    signOut() {
        const token = gapi.client.getToken();
        if (token !== null) {
            google.accounts.oauth2.revoke(token.access_token);
            gapi.client.setToken('');
        }
        this.isAuthenticated = false;
        this.accessToken = null;
    }

    async uploadFile(fileBlob, fileName, onProgress) {
        if (!this.isAuthenticated) throw new Error('Not authenticated with Google Drive');

        const metadata = {
            name: fileName,
            parents: selectedFolderId ? [selectedFolderId] : ['root']
        };

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', fileBlob);

        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();

            xhr.upload.addEventListener('progress', (e) => {
                if (e.lengthComputable) {
                    const percentComplete = (e.loaded / e.total) * 100;
                    onProgress && onProgress(percentComplete);
                }
            });

            xhr.onload = () => {
                if (xhr.status === 200) {
                    resolve(JSON.parse(xhr.responseText));
                } else {
                    reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
                }
            };

            xhr.onerror = () => reject(new Error('Upload failed: Network error'));
            xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
            xhr.setRequestHeader('Authorization', `Bearer ${this.accessToken || accessToken}`);
            xhr.send(form);
        });
    }

    async uploadMultipleFiles(files, onProgress, onFileComplete) {
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            try {
                onProgress && onProgress(i, files.length, 'uploading', file.filename);
                const result = await this.uploadFile(
                    file.blob,
                    file.filename,
                    (progress) => onProgress && onProgress(i, files.length, 'uploading', file.filename, progress)
                );
                file.uploaded = true;
                file.driveUrl = `https://drive.google.com/file/d/${result.id}/view`;
                onFileComplete && onFileComplete(file, true, result);
                onProgress && onProgress(i, files.length, 'success', file.filename, 100);
            } catch (error) {
                onFileComplete && onFileComplete(file, false, error);
                onProgress && onProgress(i, files.length, 'error', file.filename, 0);
            }
        }
    }
}

// ============================================================
// TRUE STEREO MICROPHONE MANAGER
// Captures REAL spatial information from two separate mics
// ============================================================
class TrueStereoMicrophoneManager {
    constructor() {
        this.leftMicStream = null;
        this.rightMicStream = null;
        this.leftSource = null;
        this.rightSource = null;
        this.audioContext = null;
    }

    async initialize(audioContext) {
        this.audioContext = audioContext;
        
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            
            console.log(`🎙️ Found ${audioInputs.length} audio input devices:`);
            audioInputs.forEach((device, index) => {
                console.log(`  ${index}: ${device.label || `Microphone ${index + 1}`}`);
            });

            if (audioInputs.length < 2) {
                console.error('❌ Need at least 2 microphones for stereo DoA recording');
                return false;
            }

            // Request SEPARATE streams from each physical microphone
            console.log('🔴 Requesting LEFT microphone (Mic 1)...');
            this.leftMicStream = await navigator.mediaDevices.getUserMedia({
                audio: { 
                    deviceId: { exact: audioInputs[0].deviceId }, 
                    echoCancellation: false, 
                    noiseSuppression: false, 
                    autoGainControl: false 
                }
            });

            console.log('🟢 Requesting RIGHT microphone (Mic 2)...');
            this.rightMicStream = await navigator.mediaDevices.getUserMedia({
                audio: { 
                    deviceId: { exact: audioInputs[1].deviceId }, 
                    echoCancellation: false, 
                    noiseSuppression: false, 
                    autoGainControl: false 
                }
            });

            // Create MediaStreamAudioSourceNodes for each microphone
            this.leftSource = this.audioContext.createMediaStreamAudioSource(this.leftMicStream);
            this.rightSource = this.audioContext.createMediaStreamAudioSource(this.rightMicStream);

            console.log('✅ TRUE STEREO MODE ACTIVE (Separate Microphones)');
            console.log(`   LEFT Channel (0°):  ${audioInputs[0].label || 'Microphone 1'}`);
            console.log(`   RIGHT Channel (90°): ${audioInputs[1].label || 'Microphone 2'}`);
            console.log('📊 Spatial information captured: ITDG (Inter-channel Time Delay) + ICTF (Inter-channel Level Difference)');

            return true;
        } catch (error) {
            console.error('❌ Microphone initialization failed:', error);
            return false;
        }
    }

    getLeftSource() {
        return this.leftSource;
    }

    getRightSource() {
        return this.rightSource;
    }

    stopAllStreams() {
        if (this.leftMicStream) {
            this.leftMicStream.getTracks().forEach(track => track.stop());
        }
        if (this.rightMicStream) {
            this.rightMicStream.getTracks().forEach(track => track.stop());
        }
    }
}

// ============================================================
// WAV ENCODER - True Stereo (2 independent channels)
// ============================================================
class WAVEncoder {
    static encodeWAV(leftChannelData, rightChannelData, sampleRate) {
        const numberOfSamples = leftChannelData.length;
        
        const fmt = {
            chunkId: [0x66, 0x6d, 0x74, 0x20],
            chunkSize: 16,
            audioFormat: 1,
            numChannels: 2,
            sampleRate: sampleRate,
            byteRate: sampleRate * 2 * 2,
            blockAlign: 2 * 2,
            bitsPerSample: 16
        };

        const data = {
            chunkId: [0x64, 0x61, 0x74, 0x61],
            chunkSize: numberOfSamples * 2 * 2
        };

        const fileSize = 36 + data.chunkSize;

        const wavBuffer = new ArrayBuffer(44 + data.chunkSize);
        const view = new DataView(wavBuffer);

        const setUint32 = (offset, value, littleEndian = true) => 
            view.setUint32(offset, value, littleEndian);
        const setUint16 = (offset, value, littleEndian = true) => 
            view.setUint16(offset, value, littleEndian);
        const setUint8 = (offset, value) => view.setUint8(offset, value);

        let offset = 0;

        // RIFF header
        setUint8(offset, 0x52); // 'R'
        setUint8(offset + 1, 0x49); // 'I'
        setUint8(offset + 2, 0x46); // 'F'
        setUint8(offset + 3, 0x46); // 'F'
        offset += 4;

        setUint32(offset, fileSize);
        offset += 4;

        setUint8(offset, 0x57); // 'W'
        setUint8(offset + 1, 0x41); // 'A'
        setUint8(offset + 2, 0x56); // 'V'
        setUint8(offset + 3, 0x45); // 'E'
        offset += 4;

        // fmt sub-chunk
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

        // data sub-chunk
        setUint8(offset, 0x64); // 'd'
        setUint8(offset + 1, 0x61); // 'a'
        setUint8(offset + 2, 0x74); // 't'
        setUint8(offset + 3, 0x61); // 'a'
        offset += 4;

        setUint32(offset, data.chunkSize);
        offset += 4;

        // Interleave LEFT and RIGHT channels (L, R, L, R, L, R...)
        // This preserves spatial information (ITDG + ICTF)
        let index = 0;
        const volume = 0.8;
        for (let i = 0; i < numberOfSamples; i++) {
            // LEFT channel sample
            let leftSample = Math.max(-1, Math.min(1, leftChannelData[i])) * volume;
            leftSample = leftSample < 0 ? leftSample * 0x8000 : leftSample * 0x7FFF;
            view.setInt16(offset + index, leftSample, true);
            index += 2;

            // RIGHT channel sample
            let rightSample = Math.max(-1, Math.min(1, rightChannelData[i])) * volume;
            rightSample = rightSample < 0 ? rightSample * 0x8000 : rightSample * 0x7FFF;
            view.setInt16(offset + index, rightSample, true);
            index += 2;
        }

        return new Blob([wavBuffer], { type: 'audio/wav' });
    }
}

// ============================================================
// AUDIO RECORDER - TRUE STEREO for DoA (Direction of Arrival)
// Captures spatial ground truth from 2 separate microphones
// ============================================================
class AudioRecorder {
    constructor() {
        this.audioContext = null;
        this.recordings = [];
        this.isRecording = false;
        this.countdownInterval = null;
        this.driveManager = new GoogleDriveManager();
        this.stereoMicManager = new TrueStereoMicrophoneManager();
        
        this.leftScriptProcessor = null;
        this.rightScriptProcessor = null;
        this.leftSource = null;
        this.rightSource = null;
        
        // Store INDEPENDENT left and right channel data
        this.leftChannelData = [];
        this.rightChannelData = [];
        this.sampleRate = 44100;

        document.addEventListener('DOMContentLoaded', () => this.initialize());
    }

    initialize() {
        // UI Elements
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
        this.downloadAllButton = document.getElementById('download-all-button');
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

        // Event bindings
        this.recordButton.onclick = () => this.handleRecordClick();
        this.clearAllButton.onclick = () => this.clearAllRecordings();
        this.uploadAllButton.onclick = () => this.uploadAllToDrive();
        if (this.downloadAllButton) this.downloadAllButton.onclick = () => this.downloadAllRecordings();
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

        // Initial state
        this.updateMicrophoneStatus('', 'Initializing audio system...');
        this.recordButton.disabled = true;
        this.clearAllButton.disabled = true;
        this.uploadAllButton.disabled = true;
        if (this.downloadAllButton) this.downloadAllButton.disabled = true;
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
            this.initializeAudioContext();
            this.sampleRate = this.audioContext.sampleRate;
            console.log(`Sample rate: ${this.sampleRate} Hz`);

            console.log('🎙️ Requesting dual microphone access...');
            
            const stereoSuccess = await this.stereoMicManager.initialize(this.audioContext);

            if (stereoSuccess) {
                this.leftSource = this.stereoMicManager.getLeftSource();
                this.rightSource = this.stereoMicManager.getRightSource();
                this.updateMicrophoneStatus('active', '🎙️🎙️ True Stereo (2 Physical Mics - DoA Ready)');
                this.recordButton.disabled = false;
                this.statusMessage.textContent = 'Ready to record';
                return;
            }

            this.updateMicrophoneStatus('error', 'Need 2 microphones for DoA recording');
            this.recordButton.disabled = true;
            this.statusMessage.textContent = '⚠️ 2 microphones required';

        } catch (error) {
            console.error('❌ Microphone Access Error:', error);
            
            if (error.name === 'NotAllowedError') {
                this.updateMicrophoneStatus('error', 'Permission denied - enable in settings');
            } else if (error.name === 'NotFoundError') {
                this.updateMicrophoneStatus('error', 'Microphones not found');
            } else {
                this.updateMicrophoneStatus('error', `Error: ${error.message}`);
            }
            
            this.recordButton.disabled = true;
            this.statusMessage.textContent = '❌ Microphone access failed';
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
        if (!this.leftSource || !this.rightSource) {
            return this.showError('Microphone not ready');
        }

        try {
            this.isRecording = true;
            this.leftChannelData = [];
            this.rightChannelData = [];
            this.recordButton.disabled = true;
            this.recordButton.classList.add('recording');
            this.recordButtonText.textContent = 'Recording...';
            this.statusMessage.textContent = 'Recording in progress...';
            this.statusMessage.className = 'status-message recording';

            console.log('🔴 START: Capturing TRUE STEREO from 2 separate microphones');
            console.log('   LEFT (Mic 1) → Channel 0');
            console.log('   RIGHT (Mic 2) → Channel 1');

            // Create separate script processors for LEFT and RIGHT channels
            this.leftScriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);
            this.rightScriptProcessor = this.audioContext.createScriptProcessor(4096, 1, 1);

            // LEFT microphone capture
            this.leftScriptProcessor.onaudioprocess = (event) => {
                const leftData = event.inputBuffer.getChannelData(0);
                this.leftChannelData.push(...leftData);
            };

            // RIGHT microphone capture
            this.rightScriptProcessor.onaudioprocess = (event) => {
                const rightData = event.inputBuffer.getChannelData(0);
                this.rightChannelData.push(...rightData);
            };

            // Connect LEFT microphone
            this.leftSource.connect(this.leftScriptProcessor);
            const leftSilence = this.audioContext.createMediaStreamDestination();
            this.leftScriptProcessor.connect(leftSilence);

            // Connect RIGHT microphone
            this.rightSource.connect(this.rightScriptProcessor);
            const rightSilence = this.audioContext.createMediaStreamDestination();
            this.rightScriptProcessor.connect(rightSilence);

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
        
        if (this.leftScriptProcessor) this.leftScriptProcessor.disconnect();
        if (this.rightScriptProcessor) this.rightScriptProcessor.disconnect();
        if (this.leftSource) this.leftSource.disconnect();
        if (this.rightSource) this.rightSource.disconnect();

        this.recordButtonText.textContent = 'Processing...';
        this.statusMessage.textContent = 'Encoding TRUE STEREO WAV...';
        this.statusMessage.className = 'status-message processing';
        this.countdownTimer.classList.add('hidden');

        setTimeout(() => this.processRecording(), 100);
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
        console.log(`📊 TRUE STEREO RECORDING COMPLETE:`);
        console.log(`   LEFT channel:  ${this.leftChannelData.length} samples (Mic 1)`);
        console.log(`   RIGHT channel: ${this.rightChannelData.length} samples (Mic 2)`);
        console.log(`   Sample rate: ${this.sampleRate} Hz`);
        console.log(`   Spatial info: ITDG + ICTF preserved for DoA inference`);

        // Encode with INDEPENDENT left and right channels (true stereo)
        const audioBlob = WAVEncoder.encodeWAV(
            this.leftChannelData,
            this.rightChannelData,
            this.sampleRate
        );
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
            channelCount: 2,
            encoding: 'PCM WAV True Stereo',
            spatialInfo: 'ITDG + ICTF (DoA Ground Truth)',
            leftSamples: this.leftChannelData.length,
            rightSamples: this.rightChannelData.length,
            sampleRate: this.sampleRate
        };

        this.recordings.push(recording);
        this.addRecordingToList(recording);
        this.updateFileCount();
        this.resetRecordingState();
        
        this.showSuccess(`✅ True Stereo WAV saved! Ready for DoA model training.`);
        
        this.clearAllButton.disabled = false;
        if (this.downloadAllButton) this.downloadAllButton.disabled = false;
        if (this.driveManager.isAuthenticated) this.uploadAllButton.disabled = false;
    }

    generateFilename() {
        const d = (this.directionSelect.value || '0') + 'deg';
        const dist = (this.distanceSelect.value || '1ft');
        const dur = (this.durationSelect.value || '2') + 'sec';
        const now = new Date();
        const date = `${now.getFullYear()}${(now.getMonth() + 1).toString().padStart(2, '0')}${now.getDate().toString().padStart(2, '0')}`;
        const time = `${now.getHours().toString().padStart(2, '0')}${now.getMinutes().toString().padStart(2, '0')}${now.getSeconds().toString().padStart(2, '0')}`;
        return `TrueStereo_${d}_${dist}_${dur}_${date}_${time}.wav`;
    }

    addRecordingToList(rec) {
        const emptyState = this.recordingsList.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const item = document.createElement('div');
        item.className = `recording-item${rec.uploaded ? ' uploaded' : ''}`;
        item.setAttribute('data-recording-id', rec.id);

        item.innerHTML = `
            <div class="recording-info">
                <div class="recording-filename">${rec.filename}${rec.cached ? ' 📱' : ''}${rec.uploaded ? ' ✅' : ''}</div>
                <div class="recording-details">
                    <span>Direction: ${rec.direction}°</span>
                    <span>Distance: ${rec.distance}</span>
                    <span>Duration: ${rec.duration}s</span>
                    <span>Size: ${this.formatFileSize(rec.size)}</span>
                    <span class="channel-badge">🎙️🎙️ True Stereo</span>
                    <span class="mic-badge">📊 ${rec.leftSamples} samples/ch</span>
                    <span class="encoding-badge">🧠 DoA Ground Truth</span>
                    ${rec.cached ? '<span class="pwa-status offline">📱 Offline</span>' : '<span class="pwa-status online">✓ Online</span>'}
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

    async downloadAllRecordings() {
        if (this.recordings.length === 0) return alert('No recordings to download.');

        this.downloadAllButton.disabled = true;
        this.statusMessage.textContent = 'Preparing downloads...';
        this.statusMessage.className = 'status-message processing';

        try {
            if (typeof JSZip !== 'undefined') {
                await this.downloadAsZip();
            } else {
                await this.downloadFilesSequentially();
            }
            
            this.showSuccess(`Downloaded ${this.recordings.length} file(s)!`);
        } catch (error) {
            this.showError('Download failed: ' + error.message);
        } finally {
            this.downloadAllButton.disabled = false;
            this.statusMessage.textContent = 'Ready to record';
            this.statusMessage.className = 'status-message';
        }
    }

    async downloadAsZip() {
        const zip = new JSZip();
        
        this.recordings.forEach(rec => {
            zip.file(rec.filename, rec.blob);
        });

        const content = await zip.generateAsync({ type: 'blob' });
        const url = URL.createObjectURL(content);
        const a = document.createElement('a');
        a.href = url;
        a.download = `recordings_${new Date().toISOString().slice(0, 10)}.zip`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        this.statusMessage.textContent = `Downloading all recordings as ZIP...`;
    }

    async downloadFilesSequentially() {
        for (let i = 0; i < this.recordings.length; i++) {
            const rec = this.recordings[i];
            const a = document.createElement('a');
            a.href = rec.url;
            a.download = rec.filename;
            a.style.display = 'none';
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            
            this.statusMessage.textContent = `Downloading (${i + 1}/${this.recordings.length})...`;
            
            await new Promise(resolve => setTimeout(resolve, 300));
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
                if (this.downloadAllButton) this.downloadAllButton.disabled = true;
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
        if (this.downloadAllButton) this.downloadAllButton.disabled = true;
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
                <div class="empty-icon">🎙️🎙️</div>
                <p>True Stereo DoA Recorder Ready</p>
                <p class="pwa-info">🎙️🎙️ Dual Microphone Stereo • 📊 PCM WAV True Stereo • 🧠 DoA Ground Truth • 📍 ITDG + ICTF Spatial Info</p>
            </div>
        `;
    }

    updateFileCount() {
        const count = this.recordings.length;
        const uploadedCount = this.recordings.filter(r => r.uploaded).length;
        const offlineCount = this.recordings.filter(r => r.cached).length;

        let text = `${count} DoA recording${count !== 1 ? 's' : ''}`;
        if (uploadedCount > 0) text += ` (${uploadedCount} uploaded)`;
        if (offlineCount > 0) text += ` (${offlineCount} offline)`;

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

