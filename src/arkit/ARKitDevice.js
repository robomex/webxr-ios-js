/**
 * Copyright (c) 2019 Mozilla Inc. All Rights Reserved.
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/. 
 */
import * as mat4 from 'gl-matrix/src/gl-matrix/mat4';

import XRDevice from 'webxr-polyfill/src/devices/XRDevice';

import {throttle} from '../lib/throttle.js';

import ARKitWrapper from './ARKitWrapper.js';
import ARKitWatcher from './ARKitWatcher.js';

export default class ARKitDevice extends XRDevice {
	constructor(global){
		super(global);
		this._throttledLogPose = throttle(this.logPose, 1000);

		this._sessions = new Map();
		this._activeSession = null;

		// A div prepended to body children that will contain the session layer
		this._wrapperDiv = document.createElement('div');
		this._wrapperDiv.setAttribute('class', 'arkit-device-wrapper');

		const insertWrapperDiv = () => {
			document.body.insertBefore(this._wrapperDiv, document.body.firstChild || null);
		};

		if (document.body) {
			insertWrapperDiv();
		} else {
			document.addEventListener('DOMContentLoaded', insertWrapperDiv);
		}

		this._headModelMatrix = mat4.create(); // Model and view matrix are the same
		this._projectionMatrix = mat4.create();
		this._eyeLevelMatrix = mat4.identity(mat4.create());
		this._stageMatrix = mat4.identity(mat4.create());
		this._stageMatrix[13] = -1.3;

		this._baseFrameSet = false;
		this._frameOfRefRequestsWaiting = [];

		this._depthNear = 0.1;
		this._depthFar = 1000;

		try {
			this._arKitWrapper = ARKitWrapper.GetOrCreate();
			this._arWatcher = new ARWatcher(this._arKitWrapper, this);
		} catch (e) {
			console.error('Error initializing the ARKit wrapper', e);
			this._arKitWrapper = null;
			this._arWatcher = null;
		}
	}

	// ARKitDevice specific methods

	static initStyles() {
		const init = () => {
			const styleEl = document.createElement('style');
			document.head.appendChild(styleEl);
			const styleSheet = styleEl.sheet;
			styleSheet.insertRule('.arkit-device-wrapper { z-index: -1; }', 0);
			styleSheet.insertRule('.arkit-device-wrapper, .xr-canvas { position: absolute; top: 0; left: 0; bottom: 0; right: 0; }', 0);
			styleSheet.insertRule('.arkit-device-wrapper, .arkit-device-wrapper canvas { width: 100%; height: 100%; padding: 0; margin: 0; -webkit-user-select: none; user-select: none; }', 0);
		};

		if (document.body) {
			init();
		} else {
			window.addEventListener('DOMContentLoaded', init);
		}
 
	}

	logPose() {
		console.log('pose', 
			mat4.getTranslation(new Float32Array(3), this._headModelMatrix),
			mat4.getRotation(new Float32Array(4), this._headModelMatrix)
		);
	}

	// set methods called by ARWatcher when the device data is sent from Apple ARKit

	setProjectionMatrix(matrix) {
		mat4.copy(this._projectionMatrix, matrix);
	}

	setBaseViewMatrix(matrix) {
		mat4.copy(this._headModelMatrix, matrix);
		if (!this._baseFrameSet) {
			this._baseFrameSet = true;
			for (let i = 0; i < this._frameOfRefRequestsWaiting.length; i++) {
				const callback = this._frameOfRefRequestsWaiting[i];
				try {
					callback();
				} catch(e) {
					console.error("finalization of reference frame requests failed: ", e);
				}
			}
			this._frameOfRefRequestsWaiting.length = 0;
		}
	}
		
	// XRDevice methods

	get depthNear() { return this._depthNear; }
	set depthNear(val) { this._depthNear = val; }

	get depthFar() { return this._depthFar; }
	set depthFar(val) { this._depthFar = val; }

	isSessionSupported(mode) {
		// Note: We support only immersive-ar mode for now.
		//       See https://github.com/MozillaReality/webxr-ios-js/pull/34#discussion_r334910337
		return mode === 'immersive-ar';
	}

	async requestSession(mode, xrSessionInit={}) {
		if (!this.isSessionSupported(mode)) {
			console.error('Invalid session mode', mode);
			return Promise.reject();
		}
		if (!this._arKitWrapper) {
			console.error('Session requested without an ARKitWrapper');
			return Promise.reject();
		}
		if (this._activeSession !== null) {
			console.error('Tried to start a second active session');
			return Promise.reject();
		}

		const requiredFeatures = xrSessionInit.requiredFeatures || [];
		const optionalFeatures = xrSessionInit.optionalFeatures || [];

		const ARKitOptions = {};
		if (requiredFeatures.indexOf("worldSensing") >= 0 ||
			optionalFeatures.indexOf("worldSensing") >= 0) {
			ARKitOptions.worldSensing = true;
		}
		if (requiredFeatures.indexOf("computerVision") >= 0 ||
			optionalFeatures.indexOf("computerVision") >= 0) {
			ARKitOptions.videoFrames = true;
		}
		if (requiredFeatures.indexOf("alignEUS") >= 0 ||
			optionalFeatures.indexOf("alignEUS") >= 0) {
			ARKitOptions.alignEUS = true;
		}

		await this._arKitWrapper.waitForInit().then(() => {}).catch((...params) => {
			console.error("app failed to initialize: ", ...params);
			return Promise.reject();
		});

		const watchResult = await this._arKitWrapper.watch(ARKitOptions).then((results) => {
			const session = new Session();
			this._sessions.set(session.id, session);
			this._activeSession = session;
			return Promise.resolve(session.id);
		}).catch((...params) => {
			console.error("session request failed: ", ...params);
			return Promise.reject();
		});

		return watchResult;
	}

	onBaseLayerSet(sessionId, layer) {
		this._sessions.get(sessionId).baseLayer = layer; // XRWebGLLayer
		this._wrapperDiv.appendChild(layer.context.canvas);

		layer.context.canvas.style.width = "100%";
		layer.context.canvas.style.height = "100%";
		// layer.width = layer.context.canvas.width = this._wrapperDiv.clientWidth * window.devicePixelRatio;
		// layer.height = layer.context.canvas.height = this._wrapperDiv.clientHeight * window.devicePixelRatio;
	}

	requestAnimationFrame(callback, ...params) {
		this._arKitWrapper.requestAnimationFrame(callback, params);
	}

	cancelAnimationFrame(handle) {
		return window.cancelAnimationFrame(handle);
	}

	onFrameStart(sessionId) {
		// TODO
	}

	onFrameEnd(sessionId) {
		// TODO
	}

	requestFrameOfReferenceTransform(type, options) {
		return new Promise((resolve, reject) => {
			const enqueueOrExec = (callback) => {
				if (this._baseFrameSet) {
					callback();
				} else {
					this._frameOfRefRequestsWaiting.push(callback);
				}
			};

			switch (type) {
				case 'viewer':
					enqueueOrExec(() => { 
						resolve(this._headModelMatrix);
					});
					return;
				case 'local':
					enqueueOrExec(() => { 
						resolve(this._eyeLevelMatrix);
					});
					return;
				case 'local-floor':
				case 'bounded-floor':

				// @TODO: Support unbounded reference space.
				// @TODO: Support reset event.
				//        In ARKit, the native origin can change as the user moves around.
				//        In unbounded, the space origin can change. But in other space
				//        such as local and local-floor, if the origin changes, a reset event should
				//        be triggered on the coordinate system (per the spec).
				case 'unbounded':
					reject(new Error('not supported ' + type));
					return;
				default:
					reject(new Error('Unsupported frame of reference type ' + type));
					return;
			}
		});
	}

	endSession(sessionId) {
		const session = this._sessions.get(sessionId);
		if (!session || session.ended) { return; }
		session.ended = true;
		if (this._activeSession === session) {
			this._activeSession = null;
			this._arKitWrapper.stop();
		}
		if (session.baseLayer !== null) {
			this._wrapperDiv.removeChild(session.baseLayer.context.canvas);
		}
	}

	getViewport(sessionId, eye, layer, target) {
		// A single viewport that covers the entire screen
		const { offsetWidth, offsetHeight } = layer.context.canvas;
		target.x = 0;
		target.y = 0;
		target.width = offsetWidth;
		target.height = offsetHeight;
		return true;
	}

	getProjectionMatrix(eye) {
		return this._projectionMatrix;
	}

	// The model and view matrices are the same head-model matrix
	getBasePoseMatrix() {
		return this._headModelMatrix;
	}

	getBaseViewMatrix(eye) {
		return this._headModelMatrix;
	}

	requestStageBounds() {
		return null;
	}

	getInputSources() {
		return [];
	}

	getInputPose(inputSource, coordinateSystem) {
		return null;
	}

	onWindowResize() {
		this._sessions.forEach((value, key) => {
			// var layer = value.baseLayer
			// layer.width = layer.context.canvas.width = this._wrapperDiv.clientWidth * window.devicePixelRatio;
			// layer.height = layer.context.canvas.height = this._wrapperDiv.clientHeight * window.devicePixelRatio;
		});
	}
}

let SESSION_ID = 100;
class Session {
	constructor() {
		this.ended = null; // boolean
		this.baseLayer = null; // XRWebGLLayer
		this.id = ++SESSION_ID;
	}
}

class ARWatcher extends ARKitWatcher {
	constructor(arKitWrapper, arKitDevice) {
		super(arKitWrapper);
		this._arKitDevice = arKitDevice;
	}

	handleARKitUpdate(event) {
		this._arKitDevice.setBaseViewMatrix(this._arKitWrapper._cameraTransform);
		this._arKitDevice.setProjectionMatrix(this._arKitWrapper._projectionMatrix);
	}

	handleOnError(...args) {
		console.error('ARKit error', ...args);
	}
}

