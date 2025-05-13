// This function takes the projection matrix, the translation, and two rotation angles (in radians) as input arguments.
// The two rotations are applied around x and y axes.
// It returns the combined 4x4 transformation matrix as an array in column-major order.
// The given projection matrix is also a 4x4 matrix stored as an array in column-major order.
// You can use the MatrixMult function defined in project4.html to multiply two 4x4 matrices in the same format.

function GetModelViewProjection( projectionMatrix, translationX, translationY, translationZ, rotationX, rotationY )
{	
    // Translation matrix
	var trans = [
		1, 0, 0, 0,
		0, 1, 0, 0,
		0, 0, 1, 0,
		translationX, translationY, translationZ, 1
	];

    // Rotation matrices 
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
	

	var mvp = MatrixMult( projectionMatrix, trans );  
	mvp = MatrixMult( mvp, rotationYMatrix );
	mvp = MatrixMult( mvp, rotationXMatrix );
	return mvp;
}




class MeshDrawer {

    // The constructor is a good place for taking care of the necessary initializations.
    constructor() {
        // Shader program
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


    // This method is called every time the user opens an OBJ file.
	// The arguments of this function is an array of 3D vertex positions
	// and an array of 2D texture coordinates.
	// Every item in these arrays is a floating point value, representing one
	// coordinate of the vertex position or texture coordinate.
	// Every three consecutive elements in the vertPos array forms one vertex
	// position and every three consecutive vertex positions form a triangle.
	// Similarly, every two consecutive elements in the texCoords array
	// form the texture coordinate of a vertex.
	// Note that this method can be called multiple times.
    setMesh(vertPos, texCoords) {
        this.numTriangles = vertPos.length / 3;

        // Bind and set vertex positions
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertPos), gl.STATIC_DRAW);

        // Bind and set texture coordinates
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);
    }

    // This method is called when the user changes the state of the
	// "Swap Y-Z Axes" checkbox. 
	// The argument is a boolean that indicates if the checkbox is checked.
    swapYZ(swap) {
        this.swapYZState = swap;
    }


    // This method is called to draw the triangular mesh.
	// The argument is the transformation matrix, the same matrix returned
	// by the GetModelViewProjection function above.
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


    // This method is called to set the texture of the mesh.
	// The argument is an HTML IMG element containing the texture data.
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


    // This method is called when the user changes the state of the
	// "Show Texture" checkbox. 
	// The argument is a boolean that indicates if the checkbox is checked.
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






















