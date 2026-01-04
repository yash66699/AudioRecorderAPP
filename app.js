// // Google Drive API Configuration
// const GOOGLE_CONFIG = {
//     // CLIENT_ID: '410496794049-h0fpss6kdibjtvc77hsqhjsdglt9uud6.apps.googleusercontent.com',
//     // API_KEY: 'AIzaSyD2gKW-Vi0ejhDwbR3sarHGE4KFC05vrDU',
//     CLIENT_ID: '561390564463-32380lelkhlm9a9g7r631mhbv6hln29s.apps.googleusercontent.com',
//     API_KEY: 'AIzaSyAfmO2Q-8-hGwAylaF2lRo_r7kB4vHT1aA',
//     DISCOVERY_DOC: 'https://www.googleapis.com/discovery/v1/apis/drive/v3/rest',
//     SCOPES: 'https://www.googleapis.com/auth/drive.file'
// };

// // Global Google API state
// let gapi, google;
// let isGapiLoaded = false;
// let isGisLoaded = false;
// let tokenClient;
// let accessToken = null;

// // Selected Google Drive folder ID for uploads
// let selectedFolderId = null;

// // Google API initialization (called by script tags)
// window.gapiLoaded = () => {
//     gapi = window.gapi;
//     gapi.load('client:auth2', async () => {
//         await initializeGapiClient();
//         gapi.load('picker', () => {
//             console.log('Picker API loaded');
//         });
//     });
// };
// window.gisLoaded = () => {
//     google = window.google;
//     isGisLoaded = true;
//     maybeEnableButtons();
// }; 
// async function initializeGapiClient() {
//     await gapi.client.init({
//         apiKey: GOOGLE_CONFIG.API_KEY,
//         discoveryDocs: [GOOGLE_CONFIG.DISCOVERY_DOC],
//     });
//     isGapiLoaded = true;
//     maybeEnableButtons();
// }
// // function maybeEnableButtons() {
// //     if (isGapiLoaded && isGisLoaded) {
// //         tokenClient = google.accounts.oauth2.initTokenClient({
// //             client_id: GOOGLE_CONFIG.CLIENT_ID,
// //             scope: GOOGLE_CONFIG.SCOPES,
// //             callback: (tokenResponse) => {
// //                 accessToken = tokenResponse.access_token;
// //                 window.audioRecorder && window.audioRecorder.updateAuthenticationStatus(true);
// //             },
// //         });
// //     }
// // }
// function maybeEnableButtons() {
//   if (isGapiLoaded && isGisLoaded) {
//     tokenClient = google.accounts.oauth2.initTokenClient({
//       client_id: GOOGLE_CONFIG.CLIENT_ID,
//       scope: GOOGLE_CONFIG.SCOPES,
//       callback: (resp) => {
//         if (resp.error) {
//           console.error('Error fetching access token:', resp.error);
//           window.audioRecorder && window.audioRecorder.updateAuthenticationStatus(false);
//           return;
//         }
//         accessToken = resp.access_token;
//         console.log('Access token received:', accessToken);
//         if (window.audioRecorder) {
//           window.audioRecorder.updateAuthenticationStatus(true);
//         }
//       }
//     });
//   }
// }



// // Google Drive Manager
// class GoogleDriveManager {
//     constructor() {
//         this.isAuthenticated = false;
//         this.accessToken = null;
//     }
//     async authenticate() {
//       if (!isGapiLoaded || !isGisLoaded) {    
//     throw new Error('Google APIs not loaded yet. Please wait.');
//       }
//       // Use tokenClient.requestAccessToken, rely on callback set in maybeEnableButtons()
//       return new Promise((resolve, reject) => {
//         // Don't overwrite tokenClient.callback here!
    
//         try {    
//           if (gapi.client.getToken() === null) {
//             tokenClient.requestAccessToken({ prompt: 'consent' });
//           } else {
//             tokenClient.requestAccessToken({ prompt: '' });
//           }
//           // We don't get the token response here; callback handles it.
//           // We can resolve immediately as tokenClient does asynchronous callback
//           resolve();
//         } catch (error) {
//           reject(error);
//         }
//       });
//     }            
//     signOut() {
//         const token = gapi.client.getToken();
//         if (token !== null) {
//             google.accounts.oauth2.revoke(token.access_token);
//             gapi.client.setToken('');
//         }
//         this.isAuthenticated = false;
//         this.accessToken = null;
//     }
//     async uploadFile(fileBlob, fileName, onProgress) {
//         if (!this.isAuthenticated) throw new Error('Not authenticated with Google Drive');
//         const metadata = {     
//         name: fileName, 
//         parents: selectedFolderId ? [selectedFolderId] : ['root'] 
//         };
//         const form = new FormData();
//         form.append('metadata', new Blob([JSON.stringify(metadata)], {type: 'application/json'}));
//         form.append('file', fileBlob);
//         return new Promise((resolve, reject) => {
//             const xhr = new XMLHttpRequest();
//             xhr.upload.addEventListener('progress', (e) => {    
//             if (e.lengthComputable) {
//                 const percentComplete = (e.loaded / e.total) * 100;
//                 onProgress && onProgress(percentComplete);
//             }
//             });
//             xhr.onload = () => {
//                 if (xhr.status === 200) {    
//                 resolve(JSON.parse(xhr.responseText));
//                 } else {
//                 reject(new Error(`Upload failed: ${xhr.status} ${xhr.statusText}`));
//                 }
//             };
//             xhr.onerror = () => reject(new Error('Upload failed: Network error'));
//             xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart');
//             // Use instance token or fallback to global accessToken
//             xhr.setRequestHeader('Authorization', `Bearer ${this.accessToken || accessToken}`);
//             xhr.send(form);
//         });
//     }
    
//     async uploadMultipleFiles(files, onProgress, onFileComplete) {
//         for (let i = 0; i < files.length; i++) {
//             const file = files[i];
//             try {
//                 onProgress && onProgress(i, files.length, 'uploading', file.filename);
//                 const result = await this.uploadFile(
//                     file.blob,
//                     file.filename,
//                     (progress) => onProgress && onProgress(i, files.length, 'uploading', file.filename, progress)
//                 );
//                 file.uploaded = true;
//                 file.driveUrl = `https://drive.google.com/file/d/${result.id}/view`;
//                 onFileComplete && onFileComplete(file, true, result);
//                 onProgress && onProgress(i, files.length, 'success', file.filename, 100);
//             } catch (error) {
//                 onFileComplete && onFileComplete(file, false, error);
//                 onProgress && onProgress(i, files.length, 'error', file.filename, 0);
//             }
//         }
//     }
// }

// // Audio Recorder plus Google Drive Picker integration
// class AudioRecorder {
//     constructor() {
//         this.mediaRecorder = null;
//         this.audioChunks = [];
//         this.audioContext = null;
//         this.stream = null;
//         this.recordings = [];
//         this.isRecording = false;
//         this.countdownInterval = null;
//         this.driveManager = new GoogleDriveManager();

//         document.addEventListener('DOMContentLoaded', () => this.initialize());
//     }
//     initialize() {
//         // UI Elements
//         this.directionSelect = document.getElementById('direction-select');
//         this.durationSelect = document.getElementById('duration-select');
//         this.distanceSelect = document.getElementById('distance-select');
//         this.recordButton = document.getElementById('record-button');
//         this.recordButtonText = document.getElementById('record-button-text');
//         this.statusMessage = document.getElementById('status-message');
//         this.countdownTimer = document.getElementById('countdown-timer');
//         this.micStatus = document.getElementById('mic-status-text');
//         this.micIndicator = document.querySelector('.mic-indicator');
//         this.recordingsList = document.getElementById('recordings-list');
//         this.fileCount = document.getElementById('file-count');
//         this.uploadAllButton = document.getElementById('upload-all-button');
//         this.uploadButtonText = document.getElementById('upload-button-text');
//         this.clearAllButton = document.getElementById('clear-all-button');
//         this.playbackAudio = document.getElementById('playback-audio');
//         this.googleSigninBtn = document.getElementById('google-signin-btn');
//         this.googleSignoutBtn = document.getElementById('google-signout-btn');
//         this.authIndicator = document.getElementById('auth-indicator');
//         this.authStatusText = document.getElementById('auth-status-text');
//         this.uploadProgressSection = document.getElementById('upload-progress-section');
//         this.uploadSummary = document.getElementById('upload-summary');
//         this.uploadList = document.getElementById('upload-list');
//         this.toggleSetupBtn = document.getElementById('toggle-setup');
//         this.setupContent = document.getElementById('setup-content');
//         this.selectFolderButton = document.getElementById('select-folder-button');
//         this.selectedFolderNameElement = document.getElementById('selected-folder-name');

//         // Bind events
//         this.recordButton.onclick = () => this.handleRecordClick();
//         this.clearAllButton.onclick = () => this.clearAllRecordings();
//         this.uploadAllButton.onclick = () => this.uploadAllToDrive();
//         if (this.googleSigninBtn) this.googleSigninBtn.onclick = () => this.signInToGoogleDrive();
//         if (this.googleSignoutBtn) this.googleSignoutBtn.onclick = () => this.signOutFromGoogleDrive();
//         this.toggleSetupBtn.onclick = () => this.toggleSetupInstructions();
//         // if (this.selectFolderButton) this.selectFolderButton.onclick = (e) => {
//         //     e.preventDefault();
//         //     this.createPicker();
//         // };
       

//         if (this.selectFolderButton) {
//           this.selectFolderButton.disabled = true;
//           this.selectFolderButton.onclick = (e) => {
//             e.preventDefault();
//             this.createPicker();
//           };
//         }


//         // Initial states
//         this.updateMicrophoneStatus('', 'Requesting microphone access...');
//         this.recordButton.disabled = true;
//         this.clearAllButton.disabled = true;
//         this.uploadAllButton.disabled = true;
//         if (this.selectFolderButton) this.selectFolderButton.disabled = true;
//         this.updateFileCount();
//         this.updateAuthenticationStatus(false);

//         setTimeout(() => this.requestMicrophoneAccess(), 500);
//     }
//     updateAuthenticationStatus(isAuthenticated) {
//         this.driveManager.isAuthenticated = isAuthenticated;
//         if (isAuthenticated) {
//             this.authIndicator.classList.add('connected');
//             this.authStatusText.textContent = 'Connected to Google Drive';
//             this.googleSigninBtn.classList.add('hidden');
//             this.googleSignoutBtn.classList.remove('hidden');
//             if (this.uploadAllButton && this.recordings.length > 0) this.uploadAllButton.disabled = false;
//             if (this.selectFolderButton ) this.selectFolderButton.disabled = false;
//         } else {
//             this.authIndicator.classList.remove('connected');
//             this.authStatusText.textContent = 'Not connected to Google Drive';
//             this.googleSigninBtn.classList.remove('hidden');
//             this.googleSignoutBtn.classList.add('hidden');
//             if (this.uploadAllButton) this.uploadAllButton.disabled = true;
//             if (this.selectFolderButton) {
//                 this.selectFolderButton.disabled = true;
                
//                 if (this.selectedFolderNameElement) this.selectedFolderNameElement.textContent = '';
//                 selectedFolderId = null;
//             }
//         }
//     }
//     async signInToGoogleDrive() {
//       try {
//         this.googleSigninBtn.classList.add('loading');
//         await this.driveManager.authenticate();
//         this.showSuccess('Connected to Google Drive!');
//       } catch (error) {
//         this.showError('Failed to connect: ' + error.message);
//       } finally {
//         this.googleSigninBtn.classList.remove('loading');
//       }
//     }
//     signOutFromGoogleDrive() {
//         this.driveManager.signOut();
//         this.updateAuthenticationStatus(false);
//         this.showSuccess('Signed out from Google Drive');
//     }
//     toggleSetupInstructions() {
//         const isHidden = this.setupContent.classList.contains('hidden');
//         if (isHidden) {
//             this.setupContent.classList.remove('hidden');
//             this.toggleSetupBtn.textContent = 'Hide Setup';
//         } else {
//             this.setupContent.classList.add('hidden');
//             this.toggleSetupBtn.textContent = 'Show Setup';
//         }
//     }
//     async requestMicrophoneAccess() {
//         if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
//             this.updateMicrophoneStatus('error', 'Microphone not supported');
//             return;
//         }
//         try {
//             this.stream = await navigator.mediaDevices.getUserMedia({audio: {
//                 sampleRate: 44100, channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
//             this.updateMicrophoneStatus('active', 'Microphone ready');
//             this.recordButton.disabled = false;
//             this.statusMessage.textContent = 'Ready to record';
//             this.initializeAudioContext();
//         } catch {
//             this.updateMicrophoneStatus('error', 'Microphone access denied');
//             this.recordButton.disabled = true;
//             this.statusMessage.textContent = 'Microphone access required';
//         }
//     }
//     initializeAudioContext() {
//         const AudioContext = window.AudioContext || window.webkitAudioContext;
//         if (AudioContext) this.audioContext = new AudioContext();
//     }
//     updateMicrophoneStatus(status, message) {
//         this.micStatus.textContent = message;
//         this.micIndicator.className = `mic-indicator ${status}`;
//     }
//     async handleRecordClick() {
//         if (this.isRecording) this.stopRecording();
//         else await this.startRecording();
//     }
//     async startRecording() {
//         if (!this.stream) return this.showError('No mic access');
//         try {
//             this.isRecording = true;
//             this.audioChunks = [];
//             this.recordButton.disabled = true;
//             this.recordButton.classList.add('recording');
//             this.recordButtonText.textContent = 'Preparing...';
//             this.statusMessage.textContent = 'Playing beep...';
//             this.statusMessage.className = 'status-message recording';
//             await this.playBeep();
//             const mimeType = this.getSupportedMimeType();
//             this.mediaRecorder = new MediaRecorder(this.stream, {mimeType});
//             this.mediaRecorder.ondataavailable = (e) => { if (e.data.size > 0) this.audioChunks.push(e.data); };
//             this.mediaRecorder.onstop = () => this.processRecording();
//             this.mediaRecorder.start();
//             this.recordButtonText.textContent = 'Recording...';
//             this.statusMessage.textContent = 'Recording in progress...';
//             this.countdownTimer.classList.remove('hidden');
//             const duration = parseInt(this.durationSelect.value || '2');
//             this.startCountdown(duration);
//             setTimeout(() => { if (this.isRecording) this.stopRecording(); }, duration * 1000);
//         } catch (e) {
//             this.resetRecordingState();
//             this.showError('Recording failed: ' + e.message);
//         }
//     }
//     stopRecording() {
//         if (this.mediaRecorder && this.mediaRecorder.state === 'recording') this.mediaRecorder.stop();
//         this.isRecording = false;
//         clearInterval(this.countdownInterval);
//         this.recordButtonText.textContent = 'Processing...';
//         this.statusMessage.textContent = 'Processing recording...';
//         this.statusMessage.className = 'status-message processing';
//         this.countdownTimer.classList.add('hidden');
//     }
//     async playBeep() {
//         return new Promise((resolve) => {
//             if (!this.audioContext) { setTimeout(resolve, 200); return; }
//             if (this.audioContext.state === 'suspended') this.audioContext.resume();
//             try {
//                 const oscillator = this.audioContext.createOscillator();
//                 const gainNode = this.audioContext.createGain();
//                 oscillator.connect(gainNode);
//                 gainNode.connect(this.audioContext.destination);
//                 oscillator.frequency.setValueAtTime(440, this.audioContext.currentTime);
//                 oscillator.type = 'sine';
//                 gainNode.gain.setValueAtTime(0.1, this.audioContext.currentTime);
//                 gainNode.gain.exponentialRampToValueAtTime(0.01, this.audioContext.currentTime + 0.2);
//                 oscillator.start();
//                 oscillator.stop(this.audioContext.currentTime + 0.2);
//                 oscillator.onended = resolve;
//             } catch { setTimeout(resolve, 200); }
//         });
//     }
//     startCountdown(duration) {
//         let remaining = duration;
//         const updateTimer = () => {
//             const m = Math.floor(remaining / 60), s = remaining % 60;
//             this.countdownTimer.textContent = `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
//             remaining--;
//             if (remaining < 0) clearInterval(this.countdownInterval);
//         };
//         updateTimer();
//         this.countdownInterval = setInterval(updateTimer, 1000);
//     }
//     getSupportedMimeType() {
//         const types = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/wav'];
//         for (let t of types) if (MediaRecorder.isTypeSupported(t)) return t;
//         return 'audio/webm';
//     }
//     processRecording() {
//         const audioBlob = new Blob(this.audioChunks, {type:this.getSupportedMimeType()});
//         const filename = this.generateFilename();
//         const recording = {
//             id: Date.now(),
//             filename,
//             blob: audioBlob,
//             url: URL.createObjectURL(audioBlob),
//             direction: this.directionSelect.value || '0',
//             distance: this.distanceSelect.value || '1ft',
//             duration: this.durationSelect.value || '2',
//             timestamp: new Date().toLocaleString(),
//             size: audioBlob.size,
//             cached: !navigator.onLine,
//             uploaded: false,
//             driveUrl: null
//         };
//         this.recordings.push(recording);
//         this.addRecordingToList(recording);
//         this.updateFileCount();
//         this.resetRecordingState();
//         this.showSuccess(navigator.onLine ? 'Recording saved!' : 'Saved offline!');
//         this.clearAllButton.disabled = false;
//         if (this.driveManager.isAuthenticated) this.uploadAllButton.disabled = false;
//     }
//     generateFilename() {
//         const d = (this.directionSelect.value||'0') + 'deg';
//         const dist = (this.distanceSelect.value||'1ft');
//         const dur = (this.durationSelect.value||'2') + 'sec';
//         const now = new Date();
//         const date = `${now.getFullYear()}${(now.getMonth()+1).toString().padStart(2,'0')}${now.getDate().toString().padStart(2,'0')}`;
//         const time = `${now.getHours().toString().padStart(2,'0')}${now.getMinutes().toString().padStart(2,'0')}${now.getSeconds().toString().padStart(2,'0')}`;
//         return `${d}_${dist}_${dur}_${date}_${time}.wav`;
//     }
//     addRecordingToList(rec) {
//         const emptyState = this.recordingsList.querySelector('.empty-state');
//         if (emptyState) emptyState.remove();
//         const item = document.createElement('div');
//         item.className = `recording-item${rec.uploaded ? ' uploaded' : ''}`;
//         item.setAttribute('data-recording-id', rec.id);
//         item.innerHTML = `
//             <div class="recording-info">
//                 <div class="recording-filename">${rec.filename}${rec.cached ? ' 📱' : ''}${rec.uploaded ? ' ✅' : ''}</div>
//                 <div class="recording-details">
//                     <span>Direction: ${rec.direction}°</span>
//                     <span>Distance: ${rec.distance}</span>
//                     <span>Duration: ${rec.duration}s</span>
//                     <span>Size: ${this.formatFileSize(rec.size)}</span>
//                     ${rec.cached ? '<span class="pwa-status offline">Offline</span>' : '<span class="pwa-status online">Online</span>'}
//                     ${rec.uploaded&&rec.driveUrl?`<a href="${rec.driveUrl}" target="_blank" class="drive-link">View in Drive</a>`:''}
//                 </div>
//             </div>
//             <div class="recording-actions">
//                 <button class="btn btn--sm btn--secondary play-btn">Play</button>
//                 <button class="btn btn--sm btn--outline download-btn">Download</button>
//                 <button class="btn btn--sm btn--outline delete-btn">Delete</button>
//             </div>
//         `;
//         item.querySelector('.play-btn').onclick = ()=>this.playRecording(rec.id);
//         item.querySelector('.download-btn').onclick = ()=>this.downloadRecording(rec.id);
//         item.querySelector('.delete-btn').onclick = ()=>this.deleteRecording(rec.id);
//         this.recordingsList.appendChild(item);
//     }
//     playRecording(id) {
//         const rec = this.recordings.find(r=>r.id===id);
//         if(rec && this.playbackAudio){
//             this.playbackAudio.src=rec.url;
//             this.playbackAudio.play().then(()=>this.showSuccess('Playing recording...')).catch(e=>this.showError('Playback failed: '+e.message));
//         }
//     }
//     downloadRecording(id) {
//         const rec = this.recordings.find(r=>r.id===id);
//         if(rec){
//             const a=document.createElement('a');
//             a.href=rec.url;
//             a.download=rec.filename;
//             a.style.display='none';
//             document.body.appendChild(a);
//             a.click();
//             document.body.removeChild(a);
//             this.showSuccess('Download started!');
//         }
//     }
//     deleteRecording(id) {
//         if(!confirm('Delete this recording?')) return;
//         const idx=this.recordings.findIndex(r=>r.id===id);
//         if(idx!==-1){
//             URL.revokeObjectURL(this.recordings[idx].url);
//             this.recordings.splice(idx,1);
//             const el=document.querySelector(`[data-recording-id="${id}"]`);
//             if(el) el.remove();
//             if(this.recordings.length===0){
//                 this.showEmptyState();
//                 this.clearAllButton.disabled=true;
//                 this.uploadAllButton.disabled=true;
//             }
//             this.updateFileCount();
//             this.showSuccess('Recording deleted!');
//         }
//     }
//     clearAllRecordings() {
//         if(this.recordings.length===0) return alert('No recordings to clear.');
//         if(!confirm(`Delete all ${this.recordings.length} recording(s)?`)) return;
//         this.recordings.forEach(r=>URL.revokeObjectURL(r.url));
//         this.recordings=[];
//         this.showEmptyState();
//         this.updateFileCount();
//         this.clearAllButton.disabled=true;
//         this.uploadAllButton.disabled=true;
//         this.showSuccess('All recordings cleared!');
//     }
//     async uploadAllToDrive() {
//         const filesToUpload = this.recordings.filter(r => !r.uploaded);
//         if (filesToUpload.length === 0) return alert('No new recordings to upload.');
//         if (!navigator.onLine) return alert('Upload requires internet connection.');
//         if (!this.driveManager.isAuthenticated) return alert('Please sign in to Google Drive first.');
    
//         if (this.uploadProgressSection) this.uploadProgressSection.classList.remove('hidden');
//         this.uploadAllButton.disabled = true;
//         this.uploadAllButton.classList.add('loading');
//         this.uploadButtonText.textContent = 'Uploading...';
    
//         await this.driveManager.uploadMultipleFiles(
//             filesToUpload,
//             (i, total, status, filename, progress = 0) => this.updateUploadProgress(i, total, status, filename, progress),
//             (file, success) => {
//                 if (success) this.updateRecordingInList(file);
//             }
//         );
    
//         this.uploadSummary.textContent = `Upload complete`;
//         this.showSuccess(`Uploaded ${filesToUpload.length} file(s) to Google Drive!`);
//         this.uploadAllButton.disabled = false;
//         this.uploadAllButton.classList.remove('loading');
//         this.uploadButtonText.textContent = 'Upload All to Drive';
//         setTimeout(() => this.uploadProgressSection.classList.add('hidden'), 5000);
//     }
    
//     updateUploadProgress(index,total,status,filename,progress=0){
//         if(!this.uploadList || !this.uploadSummary) return;
//         this.uploadSummary.textContent=`Uploading ${index+1} of ${total}: ${filename}`;
//         let uiItem=this.uploadList.querySelector(`[data-filename="${filename}"]`);
//         if(!uiItem){
//             uiItem=document.createElement('div');
//             uiItem.className='upload-item';
//             uiItem.setAttribute('data-filename',filename);
//             uiItem.innerHTML=`
//                 <div class="upload-item-info">
//                     <div class="upload-filename">${filename}</div>
//                     <div class="upload-status">Preparing...</div>
//                 </div>
//                 <div class="upload-progress"><div class="upload-progress-bar"></div></div>
//             `;
//             this.uploadList.appendChild(uiItem);
//         }
//         const statusEl=uiItem.querySelector('.upload-status');
//         const progressBar=uiItem.querySelector('.upload-progress-bar');
//         if(statusEl){
//             statusEl.className=`upload-status ${status}`;
//             if(status==='uploading') statusEl.textContent=`Uploading... ${Math.round(progress)}%`;
//             else if(status==='success') statusEl.textContent='Uploaded successfully';
//             else if(status==='error') statusEl.textContent='Upload failed';
//         }
//         if(progressBar) progressBar.style.width=`${progress}%`;
//     }
//     updateRecordingInList(recording) {
//         const item=document.querySelector(`[data-recording-id="${recording.id}"]`);
//         if(item){
//             item.classList.add('uploaded');
//             const filename=item.querySelector('.recording-filename');
//             if(filename && !filename.textContent.includes('✅')) filename.textContent+=' ✅';
//             const details=item.querySelector('.recording-details');
//             if(details && recording.driveUrl && !details.querySelector('.drive-link')){
//                 const a=document.createElement('a');
//                 a.href=recording.driveUrl;
//                 a.target='_blank';
//                 a.className='drive-link';
//                 a.textContent='View in Drive';
//                 details.appendChild(a);
//             }
//         }
//     }
//     showEmptyState() {
//         this.recordingsList.innerHTML=`
//             <div class="empty-state">
//                 <div class="empty-icon">📁</div>
//                 <p>No recordings yet. Start recording to see your files here.</p>
//                 <p class="pwa-info">📄 Works offline • 📱 Install as app • ☁️ Google Drive sync</p>
//             </div>
//         `;
//     }
//     updateFileCount() {
//         const count=this.recordings.length;
//         const uploadedCount=this.recordings.filter(r=>r.uploaded).length;
//         const offlineCount=this.recordings.filter(r=>r.cached).length;
//         let text=`${count} file${count!==1?'s':''}`;
//         if(uploadedCount>0) text+=` (${uploadedCount} uploaded)`;
//         if(offlineCount>0) text+=` (${offlineCount} offline)`;
//         this.fileCount.textContent=text;
//     }
//     formatFileSize(bytes) {
//         if(bytes===0) return '0 Bytes';
//         const k=1024,sizes=['Bytes','KB','MB'];
//         const i=Math.floor(Math.log(bytes)/Math.log(k));
//         return parseFloat((bytes/Math.pow(k,i)).toFixed(2))+' '+sizes[i];
//     }
//     resetRecordingState(){
//         this.isRecording=false;
//         this.recordButton.disabled=false;
//         this.recordButton.classList.remove('recording');
//         this.recordButtonText.textContent='Start Recording';
//         this.statusMessage.textContent='Ready to record';
//         this.statusMessage.className='status-message';
//         this.countdownTimer.classList.add('hidden');
//     }
//     showSuccess(msg){
//         this.statusMessage.textContent=msg;
//         this.statusMessage.className='status-message success';
//         setTimeout(()=>{
//             if(!this.isRecording){
//                 this.statusMessage.textContent='Ready to record';
//                 this.statusMessage.className='status-message';
//             }
//         },2000);
//     }
//     showError(msg){
//         this.statusMessage.textContent=msg;
//         this.statusMessage.className='status-message error';
//         setTimeout(()=>{
//             if(!this.isRecording){
//                 this.statusMessage.textContent='Ready to record';
//                 this.statusMessage.className='status-message';
//             }
//         },3000);
//     }
//     // Google Drive Picker integration
//     createPicker() {
//         if (!accessToken) {
//             alert('Please sign in first to select a folder.');
//             return;
//         }
//         const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
//                         .setSelectFolderEnabled(true)
//                         .setMimeTypes('application/vnd.google-apps.folder');
//         const picker = new google.picker.PickerBuilder()
//                         .addView(view)
//                         .setOAuthToken(accessToken)
//                         .setDeveloperKey(GOOGLE_CONFIG.API_KEY)
//                         .setCallback(this.pickerCallback.bind(this))
//                         .setSelectableMimeTypes('application/vnd.google-apps.folder')
//                         .build();
//         picker.setVisible(true);
//     }
//     pickerCallback(data) {
//         if (data.action === google.picker.Action.PICKED) {
//             const folder = data.docs[0];
//             selectedFolderId = folder.id;
//             if(this.selectedFolderNameElement) {
//                 this.selectedFolderNameElement.textContent = folder.name;
//             }
//             alert(`Selected Folder: ${folder.name}`);
//         }
//     }
// }

// window.audioRecorder = new AudioRecorder();


// Google Drive API Configuration
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

// Selected Google Drive folder ID for uploads
let selectedFolderId = null;

// Google API initialization (called by script tags)
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
                console.log('Access token received:', accessToken);
                if (window.audioRecorder) {
                    window.audioRecorder.updateAuthenticationStatus(true);
                }
            }
        });
    }
}

// Google Drive Manager
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

// Audio Recorder with Stereo Support
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
        this.stereoChannelCount = 0; // Track actual channel count

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
        this.updateMicrophoneStatus('', 'Requesting microphone access...');
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
            // ============================================
            // STEREO RECORDING CONFIGURATION
            // ============================================
            // Request 2 channels (stereo) with NO audio processing
            // to preserve spatial features
            this.stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    sampleRate: 44100,
                    channelCount: 2,              // REQUEST STEREO
                    echoCancellation: false,      // MUST be false to preserve spatial details
                    noiseSuppression: false,      // MUST be false to preserve spatial details
                    autoGainControl: false,       // MUST be false to prevent level matching
                    googAutoGainControl: false    // Extra flag for older Chrome versions
                }
            });

            // Verify actual channel count received
            const track = this.stream.getAudioTracks()[0];
            if (track) {
                const settings = track.getSettings();
                this.stereoChannelCount = settings.channelCount || 2;
                console.log('🎙️ Microphone Settings:', settings);
                
                if (this.stereoChannelCount === 2) {
                    console.log('✅ Stereo recording ACTIVE (2 channels)');
                    this.updateMicrophoneStatus('active', 'Microphone ready (Stereo - 2 channels)');
                } else if (this.stereoChannelCount === 1) {
                    console.warn('⚠️ System returned mono stream - check hardware');
                    this.updateMicrophoneStatus('active', 'Microphone ready (Mono - hardware limitation)');
                } else {
                    this.updateMicrophoneStatus('active', `Microphone ready (${this.stereoChannelCount} channels)`);
                }
            }

            this.recordButton.disabled = false;
            this.statusMessage.textContent = 'Ready to record';
            this.initializeAudioContext();
        } catch (error) {
            console.error('❌ Microphone Access Error:', error);
            this.updateMicrophoneStatus('error', 'Microphone access denied');
            this.recordButton.disabled = true;
            this.statusMessage.textContent = 'Microphone access required';
        }
    }

    initializeAudioContext() {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) this.audioContext = new AudioContext();
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
            this.audioChunks = [];
            this.recordButton.disabled = true;
            this.recordButton.classList.add('recording');
            this.recordButtonText.textContent = 'Preparing...';
            this.statusMessage.textContent = 'Playing beep...';
            this.statusMessage.className = 'status-message recording';

            await this.playBeep();

            const mimeType = this.getSupportedMimeType();
            this.mediaRecorder = new MediaRecorder(this.stream, { mimeType });

            this.mediaRecorder.ondataavailable = (e) => {
                if (e.data.size > 0) this.audioChunks.push(e.data);
            };

            this.mediaRecorder.onstop = () => this.processRecording();
            this.mediaRecorder.start();

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
        if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
            this.mediaRecorder.stop();
        }
        this.isRecording = false;
        clearInterval(this.countdownInterval);
        this.recordButtonText.textContent = 'Processing...';
        this.statusMessage.textContent = 'Processing recording...';
        this.statusMessage.className = 'status-message processing';
        this.countdownTimer.classList.add('hidden');
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

    getSupportedMimeType() {
        const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/wav'];
        for (let t of types) {
            if (MediaRecorder.isTypeSupported(t)) return t;
        }
        return 'audio/webm';
    }

    processRecording() {
        const audioBlob = new Blob(this.audioChunks, { type: this.getSupportedMimeType() });
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
            channels: this.stereoChannelCount // Store channel count in recording metadata
        };

        this.recordings.push(recording);
        this.addRecordingToList(recording);
        this.updateFileCount();
        this.resetRecordingState();
        this.showSuccess(navigator.onLine ? 'Recording saved (Stereo)!' : 'Saved offline (Stereo)!');
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

        const channelInfo = rec.channels === 2 ? '🎧 Stereo' : rec.channels === 1 ? '🔊 Mono' : `📻 ${rec.channels}ch`;

        item.innerHTML = `
            <div class="recording-info">
                <div class="recording-filename">${rec.filename}${rec.cached ? ' 📱' : ''}${rec.uploaded ? ' ✅' : ''}</div>
                <div class="recording-details">
                    <span>Direction: ${rec.direction}°</span>
                    <span>Distance: ${rec.distance}</span>
                    <span>Duration: ${rec.duration}s</span>
                    <span>Size: ${this.formatFileSize(rec.size)}</span>
                    <span class="channel-badge">${channelInfo}</span>
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
                <p class="pwa-info">📄 Works offline • 📱 Install as app • ☁️ Google Drive sync • 🎧 Stereo recording</p>
            </div>
        `;
    }

    updateFileCount() {
        const count = this.recordings.length;
        const uploadedCount = this.recordings.filter(r => r.uploaded).length;
        const offlineCount = this.recordings.filter(r => r.cached).length;
        const stereoCount = this.recordings.filter(r => r.channels === 2).length;

        let text = `${count} file${count !== 1 ? 's' : ''}`;
        if (uploadedCount > 0) text += ` (${uploadedCount} uploaded)`;
        if (offlineCount > 0) text += ` (${offlineCount} offline)`;
        if (stereoCount > 0) text += ` 🎧${stereoCount} stereo`;

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


