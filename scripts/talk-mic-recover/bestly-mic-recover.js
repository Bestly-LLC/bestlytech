/* BESTLY MIC RECOVERY PATCH v1 (prepended to Nextcloud Talk talk-main.js)
 *
 * Recovers from mid-call mic disconnects (Bluetooth flip, USB unplug, etc.).
 * When the original MediaStreamTrack fires 'ended' — Talk's UI greys the
 * mute button and never re-acquires the mic. This patch wraps
 * navigator.mediaDevices.getUserMedia so every returned MediaStream gets
 * an 'ended' handler that re-requests the mic and swaps the dead track
 * into every active RTCPeerConnection via RTCRtpSender.replaceTrack().
 *
 * Self-contained, idempotent. Safe to prepend; runs once per page load.
 * Source: bestlytech repo, scripts/talk-mic-recover/.
 */
;(function(){
  if (typeof window === 'undefined') return;
  if (window.__bestlyMicRecoveryInstalled) return;
  window.__bestlyMicRecoveryInstalled = true;

  var TAG = '[bestly-mic-recover]';
  var log = function(){ try { console.log.apply(console, [TAG].concat([].slice.call(arguments))); } catch(e){} };

  // Track every RTCPeerConnection that gets created so recovery can swap their tracks
  var allPCs = new Set();
  var OrigPC = window.RTCPeerConnection;
  if (OrigPC) {
    var PatchedPC = function(){
      // Construct via Reflect so `new` semantics preserved
      var pc = new (Function.prototype.bind.apply(OrigPC, [null].concat([].slice.call(arguments))))();
      allPCs.add(pc);
      try {
        pc.addEventListener('connectionstatechange', function(){
          if (pc.connectionState === 'closed' || pc.connectionState === 'failed') {
            allPCs.delete(pc);
          }
        });
      } catch(e){}
      return pc;
    };
    PatchedPC.prototype = OrigPC.prototype;
    Object.setPrototypeOf(PatchedPC, OrigPC);
    PatchedPC.generateCertificate = OrigPC.generateCertificate ? OrigPC.generateCertificate.bind(OrigPC) : undefined;
    window.RTCPeerConnection = PatchedPC;
  }

  // State
  var lastAudioConstraints = null;
  var recoveryInProgress = false;
  var MAX_RECOVERY_RETRIES = 3;

  function showToast(msg, color) {
    try {
      var t = document.createElement('div');
      t.textContent = msg;
      t.style.cssText = 'position:fixed;bottom:20px;right:20px;background:' + (color || '#10b981') + ';color:white;padding:8px 14px;border-radius:8px;z-index:999999;font:13px -apple-system,BlinkMacSystemFont,system-ui,sans-serif;box-shadow:0 4px 12px rgba(0,0,0,0.3)';
      document.body.appendChild(t);
      setTimeout(function(){ t.style.opacity = '0'; t.style.transition = 'opacity 0.4s'; }, 2600);
      setTimeout(function(){ t.remove(); }, 3000);
    } catch(e){}
  }

  function attachEndedHandler(stream, constraints) {
    if (!stream || !stream.getAudioTracks) return;
    stream.getAudioTracks().forEach(function(track){
      if (track.__bestlyHandled) return;
      track.__bestlyHandled = true;
      var onEnded = function(){
        log('audio track ended (label=' + track.label + ') — initiating recovery');
        recover(constraints);
      };
      track.addEventListener('ended', onEnded);
      // Some browsers only fire .onended, not addEventListener
      var existing = track.onended;
      track.onended = function(e){
        if (typeof existing === 'function') { try { existing.call(track, e); } catch(_){} }
        onEnded();
      };
    });
  }

  function recover(constraints) {
    if (recoveryInProgress) { log('recovery already in progress, skipping'); return; }
    recoveryInProgress = true;

    var attempt = 0;
    function tryAcquire(){
      attempt++;
      log('acquire attempt ' + attempt + '/' + MAX_RECOVERY_RETRIES);
      var c = constraints || lastAudioConstraints || { audio: true, video: false };
      // Force audio-only if original had video (the video track may still be live)
      var audioOnly = { audio: c.audio || true, video: false };

      navigator.mediaDevices.__bestlyOriginalGetUserMedia.call(navigator.mediaDevices, audioOnly)
        .then(function(newStream){
          var newTrack = newStream.getAudioTracks()[0];
          if (!newTrack) throw new Error('no audio track in recovered stream');
          log('acquired new track: ' + newTrack.label);

          var senderCount = 0, replacedCount = 0, failedCount = 0;
          var promises = [];
          allPCs.forEach(function(pc){
            if (!pc.getSenders) return;
            pc.getSenders().forEach(function(sender){
              if (sender.track && sender.track.kind === 'audio') {
                senderCount++;
                promises.push(
                  sender.replaceTrack(newTrack).then(function(){
                    replacedCount++;
                    log('replaced audio track in sender');
                  }).catch(function(err){
                    failedCount++;
                    log('replaceTrack failed: ' + err.message);
                  })
                );
              }
            });
          });

          Promise.all(promises).then(function(){
            log('recovery complete — senders=' + senderCount + ' replaced=' + replacedCount + ' failed=' + failedCount);
            recoveryInProgress = false;
            attachEndedHandler(newStream, constraints); // re-arm

            // Tell Talk's UI to refresh device state. Multiple signals — Talk may listen to one.
            window.dispatchEvent(new CustomEvent('bestly-mic-recovered', { detail: { track: newTrack, label: newTrack.label } }));
            window.dispatchEvent(new Event('devicechange')); // standard event Talk may subscribe to
            try { navigator.mediaDevices.dispatchEvent(new Event('devicechange')); } catch(_){}

            if (senderCount > 0) showToast('🎤 Mic recovered (' + replacedCount + '/' + senderCount + ' channels)');
            else showToast('🎤 Mic re-acquired (not in active call)');
          });
        })
        .catch(function(err){
          log('getUserMedia failed: ' + err.message + ' (attempt ' + attempt + ')');
          if (attempt < MAX_RECOVERY_RETRIES) {
            setTimeout(tryAcquire, 500 * attempt);
          } else {
            recoveryInProgress = false;
            showToast('🎤 Mic recovery failed — click 🎤 in the call to retry', '#ef4444');
          }
        });
    }
    tryAcquire();
  }

  // Wrap getUserMedia
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
    navigator.mediaDevices.__bestlyOriginalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = function(constraints){
      try { log('getUserMedia(' + JSON.stringify(constraints) + ')'); } catch(e){}
      if (constraints && constraints.audio) {
        lastAudioConstraints = constraints;
      }
      return navigator.mediaDevices.__bestlyOriginalGetUserMedia(constraints).then(function(stream){
        if (constraints && constraints.audio) attachEndedHandler(stream, constraints);
        return stream;
      });
    };
  }

  // Also expose a manual trigger for debugging — call window.__bestlyForceMicRecovery() from console
  window.__bestlyForceMicRecovery = function(){ recover(lastAudioConstraints); };

  log('installed v1 — wrapping getUserMedia and RTCPeerConnection');
})();
