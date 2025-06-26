// This function takes the translation and two rotation angles (in radians) as input arguments.
// The two rotations are applied around x and y axes.
// It returns the combined 4x4 transformation matrix as an array in column-major order.
// You can use the MatrixMult function defined in project5.html to multiply two 4x4 matrices in the same format.
function GetModelViewMatrix( translationX, translationY, translationZ, rotationX, rotationY )
{
    // Translation matrix
    var trans = [
        1, 0, 0, 0,
        0, 1, 0, 0,
        0, 0, 1, 0,
        translationX, translationY, translationZ, 1
    ];

    // Rotation matrix around X-axis
    var rotationXmatrix = [
        1, 0, 0, 0,
        0, Math.cos(rotationX), -Math.sin(rotationX), 0,
        0, Math.sin(rotationX), Math.cos(rotationX), 0,
        0, 0, 0, 1
    ];

    // Rotation matrix around Y-axis
    var rotationYmatrix = [
        Math.cos(rotationY), 0, Math.sin(rotationY), 0,
        0, 1, 0, 0,
        -Math.sin(rotationY), 0, Math.cos(rotationY), 0,
        0, 0, 0, 1
    ];

    // Combine transformations: T * Ry * Rx
    var mv = MatrixMult(rotationYmatrix, rotationXmatrix);
    mv = MatrixMult(trans, mv);

    return mv;
}


// [TO-DO] Complete the implementation of the following class.

class MeshDrawer
{
    // The constructor is a good place for taking care of the necessary initializations.
    constructor()
    {
        // Initialize shader program and get uniform/attribute locations
        this.prog = InitShaderProgram(meshVS, meshFS);
        this.mvp = gl.getUniformLocation(this.prog, 'matrixMVP');
        this.mv = gl.getUniformLocation(this.prog, 'matrixMV');
        this.normal = gl.getUniformLocation(this.prog, 'matrixNormal');
        this.lightDir = gl.getUniformLocation(this.prog, 'lightDir');
        this.shininess = gl.getUniformLocation(this.prog, 'shininess');
        this.swapYZUniform = gl.getUniformLocation(this.prog, 'swapYZ');
        this.showTextureUniform = gl.getUniformLocation(this.prog, 'showTexture');
        this.textureSampler = gl.getUniformLocation(this.prog, 'uTexture');

        // Create buffers
        this.positionBuffer = gl.createBuffer();
        this.texCoordBuffer = gl.createBuffer();
        this.normalBuffer = gl.createBuffer();
        this.texture = gl.createTexture();

        this.numTriangles = 0;
        this.swapYZState = false;
        this.showTextureState = false;
    }
    
    // This method is called every time the user opens an OBJ file.
    // The arguments of this function is an array of 3D vertex positions,
    // an array of 2D texture coordinates, and an array of vertex normals.
    // Every item in these arrays is a floating point value, representing one
    // coordinate of the vertex position or texture coordinate.
    // Every three consecutive elements in the vertPos array forms one vertex
    // position and every three consecutive vertex positions form a triangle.
    // Similarly, every two consecutive elements in the texCoords array
    // form the texture coordinate of a vertex and every three consecutive 
    // elements in the normals array form a vertex normal.
    // Note that this method can be called multiple times.
    setMesh( vertPos, texCoords, normals )
    {
        this.numTriangles = vertPos.length / 3;

        // Update vertex position buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(vertPos), gl.STATIC_DRAW);

        // Update texture coordinate buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(texCoords), gl.STATIC_DRAW);

        // Update normal buffer
        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(normals), gl.STATIC_DRAW);
    }
    
    // This method is called when the user changes the state of the
    // "Swap Y-Z Axes" checkbox. 
    // The argument is a boolean that indicates if the checkbox is checked.
    swapYZ( swap )
    {
        this.swapYZState = swap;
    }
    
    // This method is called to draw the triangular mesh.
    // The arguments are the model-view-projection transformation matrixMVP,
    // the model-view transformation matrixMV, the same matrix returned
    // by the GetModelViewProjection function above, and the normal
    // transformation matrix, which is the inverse-transpose of matrixMV.
    draw( matrixMVP, matrixMV, matrixNormal )
    {
        gl.useProgram(this.prog);

        // Set matrices
        gl.uniformMatrix4fv(this.mvp, false, matrixMVP);
        gl.uniformMatrix4fv(this.mv, false, matrixMV);
        gl.uniformMatrix3fv(this.normal, false, matrixNormal);
        
        // Set boolean uniforms
        gl.uniform1i(this.swapYZUniform, this.swapYZState);
        gl.uniform1i(this.showTextureUniform, this.showTextureState);

        // Bind and enable vertex attributes
        gl.bindBuffer(gl.ARRAY_BUFFER, this.positionBuffer);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(0);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.texCoordBuffer);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(1);

        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer);
        gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 0, 0);
        gl.enableVertexAttribArray(2);

        gl.drawArrays( gl.TRIANGLES, 0, this.numTriangles );
    }
    
    // This method is called to set the texture of the mesh.
    // The argument is an HTML IMG element containing the texture data.
    setTexture( img )
    {
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texImage2D( gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img );
        
        // Set texture parameters
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
        
        // Activate texture unit and set sampler
        gl.activeTexture(gl.TEXTURE0);
        gl.useProgram(this.prog);
        gl.uniform1i(this.textureSampler, 0);
    }
    
    // This method is called when the user changes the state of the
    // "Show Texture" checkbox. 
    // The argument is a boolean that indicates if the checkbox is checked.
    showTexture( show )
    {
        this.showTextureState = show;
    }
    
    // This method is called to set the incoming light direction
    setLightDir( x, y, z )
    {
        gl.useProgram(this.prog);
        gl.uniform3f(this.lightDir, x, y, z);
    }
    
    // This method is called to set the shininess of the material
    setShininess( shininess )
    {
        gl.useProgram(this.prog);
        gl.uniform1f(this.shininess, shininess);
    }
}


// Helper function to generate springs from mesh connectivity
function GeneratespringsFromMesh(positions, faces) {
    var springs = [];
    var springSet = new Set(); // To avoid duplicate springs
    
    // Generate springs from triangle edges
    for (var i = 0; i < faces.length; i += 3) {
        var v0 = faces[i];
        var v1 = faces[i + 1];
        var v2 = faces[i + 2];
        
        // Create springs for each edge of the triangle
        var edges = [
            [Math.min(v0, v1), Math.max(v0, v1)],
            [Math.min(v1, v2), Math.max(v1, v2)],
            [Math.min(v2, v0), Math.max(v2, v0)]
        ];
        
        for (var j = 0; j < edges.length; j++) {
            var edge = edges[j];
            var key = edge[0] + "_" + edge[1];
            
            if (!springSet.has(key)) {
                springSet.add(key);
                
                // Calculate rest length as the current distance between vertices
                var restLength = positions[edge[0]].sub(positions[edge[1]]).len();
                
                springs.push({
                    p0: edge[0],
                    p1: edge[1],
                    rest: restLength
                });
            }
        }
    }
    
    return springs;
}

// This function is called for every step of the simulation.
// Its job is to advance the simulation for the given time step duration dt.
// It updates the given positions and velocities.
function SimTimeStep( dt, positions, velocities, springs, stiffness, damping, particleMass, gravity, restitution )
{
    var forces = new Array( positions.length ); // The total force per particle
    
    // Initialize forces array with zero vectors
    for (var i = 0; i < forces.length; i++) {
        forces[i] = new Vec3();
        forces[i].init(0, 0, 0);
    }

    // Clamp time step to prevent instability
    dt = Math.min(dt, 0.016); // Maximum 16ms timestep
    
    // Only proceed if we have valid data
    if (positions.length === 0 || velocities.length === 0) {
        return;
    }

	/*
    // Simple debug info for first frame only
    if (typeof SimTimeStep.debugLogged === 'undefined') {
        var debugDiv = document.getElementById('physics-debug');
        if (!debugDiv) {
            debugDiv = document.createElement('div');
            debugDiv.id = 'physics-debug';
            debugDiv.style.position = 'absolute';
            debugDiv.style.top = '10px';
            debugDiv.style.left = '10px';
            debugDiv.style.background = 'rgba(0,0,0,0.8)';
            debugDiv.style.color = 'white';
            debugDiv.style.padding = '10px';
            debugDiv.style.fontFamily = 'monospace';
            debugDiv.style.fontSize = '12px';
            debugDiv.style.zIndex = '1000';
            document.body.appendChild(debugDiv);
        }
        debugDiv.innerHTML = "Particles: " + positions.length + "<br>Springs: " + springs.length;
        SimTimeStep.debugLogged = true;
    }
	*/

    // 1. Add gravitational forces
    for (var i = 0; i < positions.length; i++) {
        if (gravity && particleMass > 0) {
            var gravityForce = gravity.mul(particleMass);
            forces[i].inc(gravityForce);
        }
    }
    
    // 2. Add spring forces and damping
    for (var s = 0; s < springs.length; s++) {
        var spring = springs[s];
        var p0 = spring.p0;
        var p1 = spring.p1;
        var restLength = spring.rest;
        
        // Validate indices
        if (p0 < 0 || p0 >= positions.length || p1 < 0 || p1 >= positions.length || p0 === p1) {
            continue;
        }
        
        // Calculate spring vector (from p0 to p1)
        var springVector = positions[p1].sub(positions[p0]);
        var currentLength = springVector.len();
        
        // Avoid division by zero and very small lengths
        if (currentLength > 0.0001) {
            var springDirection = springVector.div(currentLength); // Unit vector
            var displacement = currentLength - restLength;
            
            // Spring force magnitude (Hooke's law: F = -kx)
            var springForceMagnitude = stiffness * displacement;
            
            // Calculate relative velocity between the two particles
            var relativeVelocity = velocities[p1].sub(velocities[p0]);
            
            // Damping force magnitude (velocity along spring direction)
            var dampingForceMagnitude = damping * relativeVelocity.dot(springDirection);
            
            // Total force magnitude along the spring
            var totalForceMagnitude = springForceMagnitude + dampingForceMagnitude;
            
            // Simple force limiting based on spring length
            var maxForce;
            if (restLength > 2.0) {
                maxForce = 5.0;   // Very weak for very long springs
            } else if (restLength > 1.0) {
                maxForce = 20.0;  // Moderate for long springs
            } else {
                maxForce = 100.0; // Normal for short springs
            }
            
            if (Math.abs(totalForceMagnitude) > maxForce) {
                totalForceMagnitude = totalForceMagnitude > 0 ? maxForce : -maxForce;
            }
            
            // Force vector
            var forceVector = springDirection.mul(totalForceMagnitude);
            
            // Apply equal and opposite forces to the particles
            forces[p0].inc(forceVector);
            forces[p1].dec(forceVector);
        }
    }
    
    // Update positions and velocities using explicit Euler integration
    for (var i = 0; i < positions.length; i++) {
        if (particleMass <= 0) continue; // Skip invalid mass
        
        // Calculate acceleration: a = F/m
        var acceleration = forces[i].div(particleMass);
        
        // Clamp acceleration to prevent explosion
        var maxAccel = 50.0;
        var accelLen = acceleration.len();
        if (accelLen > maxAccel) {
            acceleration = acceleration.div(accelLen).mul(maxAccel);
        }
        
        // Update velocity: v = v + a * dt
        var deltaV = acceleration.mul(dt);
        velocities[i].inc(deltaV);
        
        // Clamp velocity to prevent explosion
        var maxVel = 20.0;
        var velLen = velocities[i].len();
        if (velLen > maxVel) {
            velocities[i] = velocities[i].div(velLen).mul(maxVel);
        }
        
        // Update position: x = x + v * dt
        var deltaP = velocities[i].mul(dt);
        positions[i].inc(deltaP);
        
        // Check for NaN or infinite values
        if (isNaN(positions[i].x) || isNaN(positions[i].y) || isNaN(positions[i].z) ||
            !isFinite(positions[i].x) || !isFinite(positions[i].y) || !isFinite(positions[i].z)) {
            // Reset to safe position
            positions[i].init(0, 0, 0);
            velocities[i].init(0, 0, 0);
        }
        
        if (isNaN(velocities[i].x) || isNaN(velocities[i].y) || isNaN(velocities[i].z) ||
            !isFinite(velocities[i].x) || !isFinite(velocities[i].y) || !isFinite(velocities[i].z)) {
            velocities[i].init(0, 0, 0);
        }
    }
    
    // Handle collisions with the box walls
    // The collision box extends from -1 to 1 in all three dimensions
    for (var i = 0; i < positions.length; i++) {
        // Check X boundaries
        if (positions[i].x <= -1.0) {
            positions[i].x = -1.0;
            if (velocities[i].x < 0) {
                velocities[i].x = -velocities[i].x * restitution;
            }
        }
        else if (positions[i].x >= 1.0) {
            positions[i].x = 1.0;
            if (velocities[i].x > 0) {
                velocities[i].x = -velocities[i].x * restitution;
            }
        }
        
        // Check Y boundaries
        if (positions[i].y <= -1.0) {
            positions[i].y = -1.0;
            if (velocities[i].y < 0) {
                velocities[i].y = -velocities[i].y * restitution;
            }
        }
        else if (positions[i].y >= 1.0) {
            positions[i].y = 1.0;
            if (velocities[i].y > 0) {
                velocities[i].y = -velocities[i].y * restitution;
            }
        }
        
        // Check Z boundaries
        if (positions[i].z <= -1.0) {
            positions[i].z = -1.0;
            if (velocities[i].z < 0) {
                velocities[i].z = -velocities[i].z * restitution;
            }
        }
        else if (positions[i].z >= 1.0) {
            positions[i].z = 1.0;
            if (velocities[i].z > 0) {
                velocities[i].z = -velocities[i].z * restitution;
            }
        }
    }
}

// Vertex Shader (you'll need to include this in your HTML file)
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
        vec3 normal = vertNormal;
        
        if (swapYZ) {
            position = vec3(vertPosition.x, vertPosition.z, vertPosition.y);
            normal = vec3(vertNormal.x, vertNormal.z, vertNormal.y);
        }

        gl_Position = matrixMVP * vec4(position, 1.0);
        fragTexCoord = vertTexCoord;
        fragNormal = matrixNormal * normal;
        fragPosition = vec3(matrixMV * vec4(position, 1.0));
    }
`;

// Fragment Shader (you'll need to include this in your HTML file)
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

        // Diffuse lighting
        float diffuse = max(dot(normalizedNormal, normalizedLightDir), 0.0);

        // Specular lighting (Blinn-Phong)
        vec3 halfVector = normalize(normalizedLightDir + viewDir);
        float specular = pow(max(dot(normalizedNormal, halfVector), 0.0), shininess);

        vec3 color = vec3(1.0); // Default white
        if (showTexture) {
            color = texture2D(uTexture, fragTexCoord).rgb;
        }

        // Combine lighting components
        vec3 ambient = 0.1 * color;
        vec3 diffuseColor = diffuse * color;
        vec3 specularColor = specular * vec3(1.0);

        vec3 finalColor = ambient + diffuseColor + specularColor;
        gl_FragColor = vec4(finalColor, 1.0);
    }
`;


