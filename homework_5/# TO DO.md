# TO DO 

We should implement a software ray tracer that runs on the GPU. The ray tracer will be implemented using GLSL as the programming language. 

The scenes to render are different collections of spheres and point lights. The application has three rendering modes : 
- Rasterization : This mode is fully implemented. It lacks shadows and proper reflections of the spheres on the other spheres. All spheres are approximated as triangular meshes.  
- Ray Tracing : It renders the entire image using ray tracing. 
  The rendering begins with : 
  - Drawing a quad (two triangles) that covers the entire screen 
  - For each pixel of the screen, a fragment shader is called that performs ray tracing. It is this ray tracing operation inside the fragment shader that performs the actual rendering of the scene.
  So, the ray tracing mode uses RASTERIZATION to draw a quad and then the RENDERING is done inside the FRAGMENT SHADER for the quad.
- Rasterization + Ray Tracing : In this mode, the rendering is handled using
  rasterization. Ray tracing is used for computing reflections and shadows only. Ray tracing is used for computing reflections and shadows only. 