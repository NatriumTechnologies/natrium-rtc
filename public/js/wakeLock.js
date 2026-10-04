'use strict';

// https://developer.mozilla.org/en-US/docs/Web/API/WakeLock

let wakeLockSentinel = null;
let userWantsKeepAwake = false;
let syncTimeout = null;

function isWakeLockSupported() {
    return !!navigator?.wakeLock?.request;
}

function isDesktop() {
    return typeof isDesktopDevice !== 'undefined' ? isDesktopDevice : false;
}

function isAudioOrUIActive() {
    const audioStatus = typeof myAudioStatus !== 'undefined' ? myAudioStatus : false;
    const videoStatus = typeof myVideoStatus !== 'undefined' ? myVideoStatus : false;
    const screenStatus = typeof myScreenStatus !== 'undefined' ? myScreenStatus : false;
    return (audioStatus || userWantsKeepAwake) && !videoStatus && !screenStatus;
}

function shouldKeepAwake() {
    return (
        !isDesktop() &&
        isWakeLockSupported() &&
        document.visibilityState === 'visible' &&
        !document.pictureInPictureElement &&
        isAudioOrUIActive()
    );
}

async function requestWakeLock() {
    if (wakeLockSentinel || !shouldKeepAwake()) return;
    try {
        wakeLockSentinel = await navigator.wakeLock.request('screen');
        wakeLockSentinel.addEventListener('release', () => {
            wakeLockSentinel = null;
            syncWakeLockDebounced();
        });
        if (typeof switchKeepAwake !== 'undefined' && switchKeepAwake) switchKeepAwake.checked = true;
        if (typeof userLog === 'function') userLog('toast', '🟢 Wake Lock is active');
    } catch (err) {
        wakeLockSentinel = null;
        if (typeof switchKeepAwake !== 'undefined' && switchKeepAwake) switchKeepAwake.checked = false;
        if (typeof userLog === 'function') userLog('toast', '🔴 Failed to request Wake Lock: ' + err.message);
    }
}

async function releaseWakeLock() {
    if (isDesktop()) return;
    try {
        await wakeLockSentinel?.release();
        if (typeof userLog === 'function') userLog('toast', '⚪ Wake Lock released');
    } catch {}
    wakeLockSentinel = null;
    if (typeof switchKeepAwake !== 'undefined' && switchKeepAwake) switchKeepAwake.checked = false;
}

function syncWakeLockDebounced() {
    clearTimeout(syncTimeout);
    syncTimeout = setTimeout(syncWakeLock, 50);
}

async function syncWakeLock() {
    shouldKeepAwake() ? await requestWakeLock() : await releaseWakeLock();
}

function applyKeepAwake(enabled) {
    if (isDesktopDevice) return;
    userWantsKeepAwake = !!enabled;
    syncWakeLockDebounced();
}

document.addEventListener('visibilitychange', syncWakeLockDebounced);

document.addEventListener('enterpictureinpicture', releaseWakeLock);
document.addEventListener('leavepictureinpicture', syncWakeLockDebounced);

window.addEventListener('pagehide', releaseWakeLock);
