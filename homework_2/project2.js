// Returns a 3x3 transformation matrix as an array of 9 values in column-major order.
// The transformation first applies scale, then rotation, and finally translation.
// The given rotation value is in degrees.
function GetTransform(positionX, positionY, rotation, scale) {
    const radians = rotation * Math.PI / 180; 
    const cosine = Math.cos(radians);         
    const sine = Math.sin(radians);          

    // Construct the matrix in column-major order:
    // [ scale*cos(θ), sin(θ),       0
    //  -scale*sin(θ), cos(θ),       0
    //   positionX,    positionY,    1 ]
    return [
        cosine * scale, sine, 0,
        -sine * scale, cosine, 0,
        positionX, positionY, 1
    ];
}


// Returns a 3x3 transformation matrix as an array of 9 values in column-major order.
// The arguments are transformation matrices in the same format.
// The returned transformation first applies trans1 and then trans2.


function ApplyTransform(a, b) {
    const r = new Array(9); // Resultant matrix

    // Loop over rows and columns to compute each element of the result matrix
    for (let i = 0; i < 3; i++) {
        const ai0 = a[i * 3 + 0]; // Element (i,0) from matrix a
        const ai1 = a[i * 3 + 1]; // Element (i,1)
        const ai2 = a[i * 3 + 2]; // Element (i,2)

        for (let j = 0; j < 3; j++) {
            // Compute dot product for element (i,j) of the result
            r[i * 3 + j] =
                ai0 * b[j + 0] +
                ai1 * b[j + 3] +
                ai2 * b[j + 6];
        }
    }

    return r;
}


// --- Alternative version ---
// Computes the matrix product directly by manually expanding each term.
// This also applies transform `a`, followed by transform `b`.
// This is more explicit but less flexible for generalizing to different matrix sizes.
/*
function ApplyTransform(a, b) {
    const result = new Array(9);

    // Matrix multiplication (b × a), column-major order
    result[0] = b[0]*a[0] + b[3]*a[1] + b[6]*a[2];
    result[1] = b[1]*a[0] + b[4]*a[1] + b[7]*a[2];
    result[2] = b[2]*a[0] + b[5]*a[1] + b[8]*a[2];

    result[3] = b[0]*a[3] + b[3]*a[4] + b[6]*a[5];
    result[4] = b[1]*a[3] + b[4]*a[4] + b[7]*a[5];
    result[5] = b[2]*a[3] + b[5]*a[4] + b[8]*a[5];

    result[6] = b[0]*a[6] + b[3]*a[7] + b[6]*a[8];
    result[7] = b[1]*a[6] + b[4]*a[7] + b[7]*a[8];
    result[8] = b[2]*a[6] + b[5]*a[7] + b[8]*a[8];

    return result;
}
*/