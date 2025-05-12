// This function takes the projection matrix, the translation, and two rotation angles (in radians) as input arguments.
// The two rotations are applied around x and y axes.
// It returns the combined 4x4 transformation matrix as an array in column-major order.
// The given projection matrix is also a 4x4 matrix stored as an array in column-major order.
// You can use the MatrixMult function defined in project4.html to multiply two 4x4 matrices in the same format.

function GetModelViewProjection( projectionMatrix, translationX, translationY, translationZ, rotationX, rotationY )
{
	// [TO-DO] Modify the code below to form the transformation matrix.
	
	// projectionMatrix is a 4x4 matrix stored as an array in column-major order -> 1D array of 16 elements !

	var trans = [
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		translationX, translationY, translationZ, 1
	];


	var rotationXMatrix = [
 		1, 0, 0, 0,
		0, Math.cos(rotationX), -Math.sin(rotationX), 0,
		0, Math.sin(rotationX), Math.cos(rotationX), 0,
		0, 0, 0, 1
	];

	var rotationYMatrix = [
		Math.cos(rotationY), 0, Math.sin(rotationY), 0,
		0, 1, 0, 0,
		-Math.sin(rotationY), 0, Math.cos(rotationY), 0,
		0, 0, 0, 1
	];
	

	var mvp = MatrixMult( projectionMatrix, trans );   // 4x4 transformation matrix stored as an array in column-major order -> 1D array of 16 elements ! 
	mvp = MatrixMult( mvp, rotationYMatrix );
	mvp = MatrixMult( mvp, rotationXMatrix );
	return mvp;
}




class MeshDrawer {

    constructor() {
        // Compile the shader program
        this.prog = InitShaderProgram(meshVS, meshFS);

        // Get uniform locations
        this.mvp = gl.getUniformLocation(this.prog, 'mvp');
        this.swapYZUniform = gl.getUniformLocation(this.prog, 'swapYZ');
        this.showTextureUniform = gl.getUniformLocation(this.prog, 'showTexture');
        this.textureSampler = gl.getUniformLocation(this.prog, 'uTexture');

        // Get attribute locations
        this.vertPos = gl.getAttribLocation(this.prog, 'pos');
        this.texCoord = gl.getAttribLocation(this.prog, 'texCoord');

        // Create buffers
        this.vertBuffer = gl.createBuffer();
        this.texCoordBuffer = gl.createBuffer();
        this.texture = gl.createTexture();

        // Initialize state
        this.numTriangles = 0;
        this.swapYZState = false;
        this.showTextureState = false;
    }

    setMesh(vertPos, texCoords) {
        this.numTriangles = vertPos.length / 3;

        // Bind and set vertex positions
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertPos), gl.STATIC_DRAW);

        // Bind and set texture coordinates
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
    }

    swapYZ(swap) {
        this.swapYZState = swap;
    }




    draw(trans) {
        gl.useProgram(this.prog);
        gl.uniformMatrix4fv(this.mvp, false, trans);
        gl.uniform1i(this.swapYZUniform, this.swapYZState);
        gl.uniform1i(this.showTextureUniform, this.showTextureState);

        // Bind vertex positions
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.vertexAttribPointer(this.vertPos, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.vertPos);

        // Bind texture coordinates
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.vertexAttribPointer(this.texCoord, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(this.texCoord);

        // Draw triangles
        gl.drawArrays(gl.TRIANGLES, 0, this.numTriangles);
    }



    setTexture(img) {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
		gl.activeTexture(gl.TEXTURE0);
        gl.uniform1i(this.textureLocation, 0);
		this.showTexture(true);
    }




    showTexture(show) {
        this.showTextureState = show;
    }
}

// Vertex Shader
const meshVS = `
    attribute vec3 pos;
    attribute vec2 texCoord;
    uniform mat4 mvp;
    uniform bool swapYZ;
    varying vec2 vTexCoord;
    void main() {
        vec3 position = pos;
        if (swapYZ) {
            position = vec3(pos.x, pos.z, pos.y);
        }
        gl_Position = mvp * vec4(position, 1.0);
        vTexCoord = texCoord;
    }
`;

// Fragment Shader
const meshFS = `
    precision mediump float;
    uniform sampler2D uTexture;
    uniform bool showTexture;
    varying vec2 vTexCoord;
    void main() {
        if (showTexture) {
            gl_FragColor = texture2D(uTexture, vTexCoord);
        } else {
            gl_FragColor = vec4(1, gl_FragCoord.z * gl_FragCoord.z, 0, 1);
        }
    }
`;






















