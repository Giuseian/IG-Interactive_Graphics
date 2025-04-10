// bgImg is the background image to be modified.
// fgImg is the foreground image.
// fgOpac is the opacity of the foreground image.
// fgPos is the position of the foreground image in pixels. It can be negative and (0,0) means the top-left pixels of the foreground and background are aligned.


// CLASSIC ALPHA BLENDING : C = ALPHA_F * C_F + (1 - ALPHA_F) * C_B


function composite(bgImg, fgImg, fgOpac, fgPos) {
    const bgWidth = bgImg.width;
    const bgHeight = bgImg.height;
    const fgWidth = fgImg.width;
    const fgHeight = fgImg.height;

    const bgData = bgImg.data; // Array of background pixels in RGBA format (1D array)
    const fgData = fgImg.data; // Array of foreground pixels in RGBA format (1D array)

    // Iterate over each pixel in the foreground image
    for (let fy = 0; fy < fgHeight; fy++) {
        for (let fx = 0; fx < fgWidth; fx++) {
            // Compute the corresponding x and y coordinates in the background image
            const bx = fx + fgPos.x;
            const by = fy + fgPos.y;

            // Skip this pixel if it lies outside the background image bounds
            if (bx < 0 || bx >= bgWidth || by < 0 || by >= bgHeight) {
                continue;
            }

            // Compute the 1D index for the current pixel in both foreground and background images
            const fgIndex = (fy * fgWidth + fx) * 4; // Each pixel has 4 values: R, G, B, A
            const bgIndex = (by * bgWidth + bx) * 4;

            // Retrieve the RGBA components of the foreground pixel
            const fgR = fgData[fgIndex];       // Red channel
            const fgG = fgData[fgIndex + 1];   // Green channel
            const fgB = fgData[fgIndex + 2];   // Blue channel
            const fgA = (fgData[fgIndex + 3] / 255) * fgOpac; // Alpha (normalized to [0, 1]) and scaled by fgOpac

            // Retrieve the RGB components of the corresponding background pixel
            const bgR = bgData[bgIndex];       // Red channel
            const bgG = bgData[bgIndex + 1];   // Green channel
            const bgB = bgData[bgIndex + 2];   // Blue channel

            // Perform alpha blending for each color channel using the classic formula:
            // C_result = alpha_foreground * C_foreground + (1 - alpha_foreground) * C_background
            bgData[bgIndex]     = fgA * fgR + (1 - fgA) * bgR; // Red
            bgData[bgIndex + 1] = fgA * fgG + (1 - fgA) * bgG; // Green
            bgData[bgIndex + 2] = fgA * fgB + (1 - fgA) * bgB; // Blue
        }
    }
}
