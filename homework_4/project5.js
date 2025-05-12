// This function takes the translation and two rotation angles (in radians) as input arguments.
// The two rotations are applied around x and y axes.
// It returns the combined 4x4 transformation matrix as an array in column-major order.
// You can use the MatrixMult function defined in project5.html to multiply two 4x4 matrices in the same format.
function GetModelViewMatrix( translationX, translationY, translationZ, rotationX, rotationY )
{
    var trans = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        translationX, translationY, translationZ, 1
    ];

    var rotationXmatrix = [
        1, 0, 0, 0,
        0, Math.cos(rotationX), -Math.sin(rotationX), 0,
        0, Math.sin(rotationX), Math.cos(rotationX), 0,
        0, 0, 0, 1
    ];

    var rotationYmatrix = [
        Math.cos(rotationY), 0, Math.sin(rotationY), 0,
        0, 1, 0, 0,
        -Math.sin(rotationY), 0, Math.cos(rotationY), 0,
        0, 0, 0, 1
    ];

    var mv = MatrixMult(rotationYmatrix, rotationXmatrix);
    mv = MatrixMult(trans, mv);

    return mv;
}


class MeshDrawer {

    constructor() {
        this.prog = InitShaderProgram(meshVS, meshFS);
        this.mvp = gl.getUniformLocation(this.prog, 'matrixMVP');
        this.mv = gl.getUniformLocation(this.prog, 'matrixMV');
        this.normal = gl.getUniformLocation(this.prog, 'matrixNormal');
        this.lightDir = gl.getUniformLocation(this.prog, 'lightDir');
        this.shininess = gl.getUniformLocation(this.prog, 'shininess');
        this.swapYZUniform = gl.getUniformLocation(this.prog, 'swapYZ');
        this.showTextureUniform = gl.getUniformLocation(this.prog, 'showTexture');
        this.textureSampler = gl.getUniformLocation(this.prog, 'uTexture');

        this.positionBuffer = gl.createBuffer();
        this.texCoordBuffer = gl.createBuffer();
        this.normalBuffer = gl.createBuffer();
        this.texture = gl.createTexture();

        this.numTriangles = 0;
        this.swapYZState = false;
        this.showTextureState = false;
    }

    setMesh(vertPos, texCoords, normals) {
        this.numTriangles = vertPos.length / 3;

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertPos), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    }


	swapYZ(swap) {
		this.swapYZState = swap;
	}


	draw(matrixMVP, matrixMV, matrixNormal) {
        gl.useProgram(this.prog);

        gl.uniformMatrix4fv(this.mvp, false, matrixMVP);
        gl.uniformMatrix4fv(this.mv, false, matrixMV);
        gl.uniformMatrix3fv(this.normal, false, matrixNormal);
        gl.uniform1i(this.swapYZUniform, this.swapYZState);
        gl.uniform1i(this.showTextureUniform, this.showTextureState);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(2);

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
        gl.uniform1i(this.textureSampler, 0);
        this.showTexture(true);
    }

    showTexture(show) {
        this.showTextureState = show;
    }


    setLightDir(x, y, z) {
        gl.useProgram(this.prog);
        gl.uniform3f(this.lightDir, x, y, z);
    }

    setShininess(shininess) {
        gl.useProgram(this.prog);
        gl.uniform1f(this.shininess, shininess);
    }

    

}


// Vertex Shader
const meshVS = `
    attribute vec3 vertPosition;
    attribute vec2 vertTexCoord;
    attribute vec3 vertNormal;

    uniform mat4 matrixMVP;
    uniform mat4 matrixMV;
    uniform mat3 matrixNormal;
    uniform bool swapYZ;

    varying vec2 fragTexCoord;
    varying vec3 fragNormal;
    varying vec3 fragPosition;

    void main() {
        vec3 position = vertPosition;
        if (swapYZ) {
            position = vec3(vertPosition.x, vertPosition.z, vertPosition.y);
        }

        gl_Position = matrixMVP * vec4(position, 1.0);
        fragTexCoord = vertTexCoord;
        fragNormal = matrixNormal * vertNormal;
        fragPosition = vec3(matrixMV * vec4(position, 1.0));
    }
`;


// Fragment Shader
const meshFS = `
    precision mediump float;

    uniform sampler2D uTexture;
    uniform bool showTexture;
    uniform vec3 lightDir;
    uniform float shininess;

    varying vec2 fragTexCoord;
    varying vec3 fragNormal;
    varying vec3 fragPosition;

    void main() {
        vec3 normalizedNormal = normalize(fragNormal);
        vec3 normalizedLightDir = normalize(lightDir);
        vec3 viewDir = normalize(-fragPosition);

        // Diffuse Component
        float diffuse = max(dot(normalizedNormal, normalizedLightDir), 0.0);

        // Specular Component using Blinn-Phong
        vec3 halfVector = normalize(normalizedLightDir + viewDir);
        float specular = pow(max(dot(normalizedNormal, halfVector), 0.0), shininess);

        vec3 color = vec3(1.0); // Default white

        if (showTexture) {
            color = texture2D(uTexture, fragTexCoord).rgb;
        }

        vec3 ambient = 0.1 * color;
        vec3 diffuseColor = diffuse * color;
        vec3 specularColor = specular * vec3(1.0);

        vec3 finalColor = ambient + diffuseColor + specularColor;

        gl_FragColor = vec4(finalColor, 1.0);
    }
`;

