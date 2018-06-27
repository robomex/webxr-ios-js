import MatrixMath from '../math/MatrixMath.js'
import Quaternion from '../math/Quaternion.js'

/*
XRDevicePose describes the position and orientation of an XRDevice relative to the query XRFrameOfReference.
It also describes the view and projection matrices that should be used by the application to render a frame of the XR scene.
*/
export default class XRDevicePose {
	constructor(position=[0, 0, 0], orientation=[0, 0, 0, 1]){
		this._poseModelMatrix = new Float32Array(16)
		MatrixMath.mat4_fromRotationTranslation(this._poseModelMatrix, orientation, position)
	}

	getViewMatrix(view){
		const out = new Float32Array(16)
		MatrixMath.mat4_eyeView(out, this._poseModelMatrix)
		return out
	}

	get poseModelMatrix(){ return this._poseModelMatrix }

	_setPoseModelMatrix(array16){
		for(let i=0; i < 16; i++){
			this._poseModelMatrix[i] = array16[i]
		}
	}

	get _position(){
		return [this._poseModelMatrix[12], this._poseModelMatrix[13], this._poseModelMatrix[14]]
	}

	set _position(array3){
		this._poseModelMatrix[12] = array3[0]
		this._poseModelMatrix[13] = array3[1]
		this._poseModelMatrix[14] = array3[2]
	}

	get _orientation(){
		let quat = new Quaternion()
		quat.setFromRotationMatrix(this._poseModelMatrix)
		return quat.toArray()
	}

	set _orientation(array4){
		MatrixMath.mat4_fromRotationTranslation(this._poseModelMatrix, array4, this._position)
	}

	_translate(array3){
		this._poseModelMatrix[12] += array3[0]
		this._poseModelMatrix[13] += array3[1]
		this._poseModelMatrix[14] += array3[2]
	}
}