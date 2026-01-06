// ============================================================
// GOOGLE DRIVE API CONFIGURATION
// ============================================================
const GOOGLE_CONFIG = {
    CLIENT_ID: '561390564463-32380lelkhlm9a9g7r631mhbv6hln29s.apps.googleusercontent.com',
    API_KEY: 'AIzaSyAfmO2Q-8-hGwAylaF2lRo_r7kB4vHT1aA',
    DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
    SCOPES: 'https://www.googleapis.com/auth/drive.file'
};

// Global Google API state
let gapi, google;
let isGapiLoaded = false;
let isGisLoaded = false;
let tokenClient;
let accessToken = null;
let selectedFolderId = null;

// Google API initialization
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
// DUAL MICROPHONE MANAGER
// ============================================================
class DualMicrophoneManager {
    constructor() {
        this.streams = [];
        this.sources = [];
        this.splitters = [];
        this.audioContext = null;
        this.destinationNode = null;
        this.mediaStreamDestination = null;
        this.stereoStream = null;
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
                console.warn('⚠️ Only one microphone found. Using mono fallback.');
                return false;
            }

            this.mediaStreamDestination = this.audioContext.createMediaStreamDestination();
            this.stereoStream = this.mediaStreamDestination.stream;

            const firstMic = await navigator.mediaDevices.getUserMedia({
                audio: { 
                    deviceId: audioInputs[0].deviceId, 
                    echoCancellation: false, 
                    noiseSuppression: false, 
                    autoGainControl: false 
                }
            });

            const secondMic = await navigator.mediaDevices.getUserMedia({
                audio: { 
                    deviceId: audioInputs[1].deviceId, 
                    echoCancellation: false, 
                    noiseSuppression: false, 
                    autoGainControl: false 
                }
            });

            this.streams = [firstMic, secondMic];

            const source1 = this.audioContext.createMediaStreamSource(firstMic);
            const source2 = this.audioContext.createMediaStreamSource(secondMic);

            this.sources = [source1, source2];

            const splitter1 = this.audioContext.createChannelSplitter(1);
            const splitter2 = this.audioContext.createChannelSplitter(1);

            this.splitters = [splitter1, splitter2];

            const merger = this.audioContext.createChannelMerger(2);

            source1.connect(splitter1);
            splitter1.connect(merger, 0, 0);

            source2.connect(splitter2);
            splitter2.connect(merger, 0, 1);

            merger.connect(this.mediaStreamDestination);

            console.log('✅ Dual microphone stereo mode ACTIVE');
            console.log(`   Left Channel: ${audioInputs[0].label || 'Microphone 1'}`);
            console.log(`   Right Channel: ${audioInputs[1].label || 'Microphone 2'}`);

            return true;
        } catch (error) {
            console.error('❌ Dual microphone initialization failed:', error);
            return false;
        }
    }

    getStream() {
        return this.stereoStream;
    }

    stopAllStreams() {
        this.streams.forEach(stream => {
            stream.getTracks().forEach(track => track.stop());
        });
        this.streams = [];
        this.sources = [];
        this.splitters = [];
    }
}

// ============================================================
// WAV ENCODER
// ============================================================
class WAVEncoder {
    static encodeWAV(audioData, sampleRate, numChannels) {
        const numberOfSamples = audioData[0].length;
        const fmt = {
            chunkId: [0x66, 0x6d, 0x74, 0x20],
            chunkSize: 16,
            audioFormat: 1,
            numChannels: numChannels,
            sampleRate: sampleRate,
            byteRate: sampleRate * numChannels * 2,
            blockAlign: numChannels * 2,
            bitsPerSample: 16
        };

        const data = {
            chunkId: [0x64, 0x61, 0x74, 0x61],
            chunkSize: numberOfSamples * numChannels * 2
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

        // Interleave audio data (L, R, L, R, ...)
        let index = 0;
        const volume = 0.8;
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
// AUDIO RECORDER (NO BEEP)
// ============================================================
class AudioRecorder {
    constructor() {
        this.audioContext = null;
        this.stream = null;
        this.recordings = [];
        this.isRecording = false;
        this.countdownInterval = null;
        this.driveManager = new GoogleDriveManager();
        this.dualMicManager = new DualMicrophoneManager();
        this.stereoChannelCount = 0;
        this.usingStereoMics = false;
        
        this.scriptProcessorNode = null;
        this.source = null;
        
        // Store separated channels
        this.channelLeftData = [];
        this.channelRightData = [];
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

            console.log('🎙️ Requesting microphone permission...');
            const permissionStream = await navigator.mediaDevices.getUserMedia({
                audio: { 
                    echoCancellation: false, 
                    noiseSuppression: false, 
                    autoGainControl: false 
                }
            });

            console.log('✅ Microphone permission granted');

            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(device => device.kind === 'audioinput');
            
            console.log(`🎙️ Found ${audioInputs.length} audio input devices:`);
            audioInputs.forEach((device, index) => {
                console.log(`  ${index}: ${device.label || `Microphone ${index + 1}`}`);
            });

            if (audioInputs.length >= 2) {
                console.log('🔄 Attempting dual microphone mode...');
                const dualMicSuccess = await this.dualMicManager.initialize(this.audioContext);

                if (dualMicSuccess) {
                    this.stream = this.dualMicManager.getStream();
                    this.stereoChannelCount = 2;
                    this.usingStereoMics = true;
                    this.updateMicrophoneStatus('active', '🎙️🎙️ Dual Microphones (Separate Channels)');
                    
                    permissionStream.getTracks().forEach(track => track.stop());
                    
                    this.recordButton.disabled = false;
                    this.statusMessage.textContent = 'Ready to record';
                    return;
                }
            }

            console.log('⚙️ Using single microphone with stereo request...');
            this.stream = permissionStream;

            const track = this.stream.getAudioTracks()[0];
            if (track) {
                const settings = track.getSettings();
                this.stereoChannelCount = settings.channelCount || 1;
                console.log('Microphone Settings:', settings);
                
                if (this.stereoChannelCount === 2) {
                    console.log('✅ Stereo recording ACTIVE');
                    this.updateMicrophoneStatus('active', '🎤 Single Microphone (Separate Channels)');
                } else {
                    console.warn('⚠️ System returned mono stream');
                    this.updateMicrophoneStatus('active', '🔊 Mono Mode (Check device support)');
                }
            }

            this.recordButton.disabled = false;
            this.statusMessage.textContent = 'Ready to record';

        } catch (error) {
            console.error('❌ Microphone Access Error:', error);
            
            if (error.name === 'NotAllowedError') {
                this.updateMicrophoneStatus('error', 'Permission denied - enable in settings');
            } else if (error.name === 'NotFoundError') {
                this.updateMicrophoneStatus('error', 'No microphone found');
            } else {
                this.updateMicrophoneStatus('error', `Error: ${error.message}`);
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
            // Reset buffers
            this.channelLeftData = [];
            this.channelRightData = [];
            this.recordButton.disabled = true;
            this.recordButton.classList.add('recording');
            this.recordButtonText.textContent = 'Recording...';
            this.statusMessage.textContent = 'Recording in progress...';
            this.statusMessage.className = 'status-message recording';

            // Start capture immediately (NO BEEP)
            console.log('🔴 Starting audio capture (SEPARATE CHANNELS)...');
            this.source = this.audioContext.createMediaStreamSource(this.stream);
            
            this.scriptProcessorNode = this.audioContext.createScriptProcessor(4096, 2, 2);

            this.scriptProcessorNode.onaudioprocess = (event) => {
                const leftData = event.inputBuffer.getChannelData(0);
                const rightData = event.inputBuffer.getChannelData(1);

                this.channelLeftData.push(...leftData);
                this.channelRightData.push(...rightData);
            };

            this.source.connect(this.scriptProcessorNode);
            
            // Keep processor alive but silent (no feedback)
            const silenceTarget = this.audioContext.createMediaStreamDestination();
            this.scriptProcessorNode.connect(silenceTarget);

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
        
        if (this.scriptProcessorNode) {
            this.scriptProcessorNode.disconnect();
        }
        if (this.source) {
            this.source.disconnect();
        }

        this.recordButtonText.textContent = 'Processing...';
        this.statusMessage.textContent = 'Encoding WAV files...';
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
        console.log(`📊 Recording complete:`);
        console.log(`   Left channel: ${this.channelLeftData.length} samples`);
        console.log(`   Right channel: ${this.channelRightData.length} samples`);
        console.log(`   Sample rate: ${this.sampleRate} Hz`);

        // Encode separated channels into a single Stereo WAV
        const stereoData = [this.channelLeftData, this.channelRightData];
        const audioBlob = WAVEncoder.encodeWAV(stereoData, this.sampleRate, 2);
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
            encoding: 'PCM WAV (Separate Channels)',
            rawChannelLeft: this.channelLeftData,
            rawChannelRight: this.channelRightData
        };

        this.recordings.push(recording);
        this.addRecordingToList(recording);
        this.updateFileCount();
        this.resetRecordingState();
        
        const recordingType = this.usingStereoMics ? 'Dual Mic WAV (Separate)' : 'Stereo WAV (Separate)';
        this.showSuccess(navigator.onLine ? `Recording saved (${recordingType})!` : `Saved offline (${recordingType})!`);
        
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
        return `${d}_${dist}_${dur}_${date}_${time}.wav`;
    }

    addRecordingToList(rec) {
        const emptyState = this.recordingsList.querySelector('.empty-state');
        if (emptyState) emptyState.remove();

        const item = document.createElement('div');
        item.className = `recording-item${rec.uploaded ? ' uploaded' : ''}`;
        item.setAttribute('data-recording-id', rec.id);

        const channelInfo = '🎧 Stereo (L/R Separate)';
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
                <div class="empty-icon">📁</div>
                <p>No recordings yet. Start recording to see your files here.</p>
                <p class="pwa-info">📄 Works offline • 📱 Install as app • ☁️ Google Drive sync • 🎙️🎙️ Dual Mic Stereo • 📊 PCM WAV (Separate Channels)</p>
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
