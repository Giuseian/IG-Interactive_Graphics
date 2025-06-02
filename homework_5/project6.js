
// var raytraceFS = `
// struct Ray {
// 	vec3 pos;
// 	vec3 dir;
// };

// struct Material {
// 	vec3  k_d;	// diffuse coefficient
// 	vec3  k_s;	// specular coefficient
// 	float n;	// specular exponent
// };

// struct Sphere {
// 	vec3     center;
// 	float    radius;
// 	Material mtl;
// };

// struct Light {
// 	vec3 position;
// 	vec3 intensity;
// };

// struct HitInfo {
// 	float    t;
// 	vec3     position;
// 	vec3     normal;
// 	Material mtl;
// };

// uniform Sphere spheres[ NUM_SPHERES ];
// uniform Light  lights [ NUM_LIGHTS  ];
// uniform samplerCube envMap;
// uniform int bounceLimit;

// bool IntersectRay( inout HitInfo hit, Ray ray );

// // Shades the given point and returns the computed color.
// vec3 Shade( Material mtl, vec3 position, vec3 normal, vec3 view )
// {
// 	vec3 color = vec3(0,0,0);
// 	for ( int i=0; i<NUM_LIGHTS; ++i ) {
// 		// TO-DO: Check for shadows
// 		// TO-DO: If not shadowed, perform shading using the Blinn model
// 		color += mtl.k_d * lights[i].intensity;	// change this line
// 	}
// 	return color;
// }

// // Intersects the given ray with all spheres in the scene
// // and updates the given HitInfo using the information of the sphere
// // that first intersects with the ray.
// // Returns true if an intersection is found.
// bool IntersectRay( inout HitInfo hit, Ray ray )
// {
// 	hit.t = 1e30;
// 	bool foundHit = false;
// 	for ( int i=0; i<NUM_SPHERES; ++i ) {
// 		// TO-DO: Test for ray-sphere intersection
// 		// TO-DO: If intersection is found, update the given HitInfo
// 	}
// 	return foundHit;
// }

// // Given a ray, returns the shaded color where the ray intersects a sphere.
// // If the ray does not hit a sphere, returns the environment color.
// vec4 RayTracer( Ray ray )
// {
// 	HitInfo hit;
// 	if ( IntersectRay( hit, ray ) ) {
// 		vec3 view = normalize( -ray.dir );
// 		vec3 clr = Shade( hit.mtl, hit.position, hit.normal, view );
		
// 		// Compute reflections
// 		vec3 k_s = hit.mtl.k_s;
// 		for ( int bounce=0; bounce<MAX_BOUNCES; ++bounce ) {
// 			if ( bounce >= bounceLimit ) break;
// 			if ( hit.mtl.k_s.r + hit.mtl.k_s.g + hit.mtl.k_s.b <= 0.0 ) break;
			
// 			Ray r;	// this is the reflection ray
// 			HitInfo h;	// reflection hit info
			
// 			// TO-DO: Initialize the reflection ray
			
// 			if ( IntersectRay( h, r ) ) {
// 				// TO-DO: Hit found, so shade the hit point
// 				// TO-DO: Update the loop variables for tracing the next reflection ray
// 			} else {
// 				// The refleciton ray did not intersect with anything,
// 				// so we are using the environment color
// 				clr += k_s * textureCube( envMap, r.dir.xzy ).rgb;
// 				break;	// no more reflections
// 			}
// 		}
// 		return vec4( clr, 1 );	// return the accumulated color, including the reflections
// 	} else {
// 		return vec4( textureCube( envMap, ray.dir.xzy ).rgb, 0 );	// return the environment color
// 	}
// }
// `;


//   Good, but rast + raytracing is not working 
/*
var raytraceFS = `
struct Ray {
	vec3 pos;
	vec3 dir;
};

struct Material {
	vec3  k_d;	// diffuse coefficient
	vec3  k_s;	// specular coefficient
	float n;	// specular exponent
};

struct Sphere {
	vec3     center;
	float    radius;
	Material mtl;
};

struct Light {
	vec3 position;
	vec3 intensity;
};

struct HitInfo {
	float    t;
	vec3     position;
	vec3     normal;
	Material mtl;
};

uniform Sphere spheres[ NUM_SPHERES ];
uniform Light  lights [ NUM_LIGHTS  ];
uniform samplerCube envMap;
uniform int bounceLimit;

bool IntersectRay( inout HitInfo hit, Ray ray );

// Shades the given point and returns the computed color.
vec3 Shade(Material mtl, vec3 position, vec3 normal, vec3 view)
{
    vec3 color = vec3(0.0);
    
    for (int i = 0; i < NUM_LIGHTS; ++i) {
        vec3 lightDir = normalize(lights[i].position - position);
        
        // Shadow check
        Ray shadowRay;
        shadowRay.pos = position + 0.001 * normal;  // small bias
        shadowRay.dir = lightDir;
        
        HitInfo shadowHit;
        bool inShadow = IntersectRay(shadowHit, shadowRay);
        float lightDist = length(lights[i].position - position);
        
        if (inShadow && shadowHit.t < lightDist) {
            continue;  // in shadow
        }

        // Diffuse term
        float diff = max(dot(normal, lightDir), 0.0);
        vec3 diffuse = mtl.k_d * lights[i].intensity * diff;

        // Specular term (Blinn)
        vec3 halfVec = normalize(lightDir + view);
        float spec = pow(max(dot(normal, halfVec), 0.0), mtl.n);
        vec3 specular = mtl.k_s * lights[i].intensity * spec;

        color += diffuse + specular;
    }
    
    return color;
}


// Intersects the given ray with all spheres in the scene
// and updates the given HitInfo using the information of the sphere
// that first intersects with the ray.
// Returns true if an intersection is found.
bool IntersectRay( inout HitInfo hit, Ray ray )
{
    hit.t = 1e30;
    bool foundHit = false;
    
    for (int i = 0; i < NUM_SPHERES; ++i) {
        Sphere sphere = spheres[i];
        vec3 oc = ray.pos - sphere.center;
        
        float a = dot(ray.dir, ray.dir);
        float b = 2.0 * dot(oc, ray.dir);
        float c = dot(oc, oc) - sphere.radius * sphere.radius;
        
        float discriminant = b*b - 4.0*a*c;
        if (discriminant > 0.0) {
            float sqrtDisc = sqrt(discriminant);
            float t1 = (-b - sqrtDisc) / (2.0 * a);
            float t2 = (-b + sqrtDisc) / (2.0 * a);
            
            float t = (t1 > 0.0) ? t1 : ((t2 > 0.0) ? t2 : -1.0);
            if (t > 0.0 && t < hit.t) {
                hit.t = t;
                hit.position = ray.pos + t * ray.dir;
                hit.normal = normalize(hit.position - sphere.center);
                hit.mtl = sphere.mtl;
                foundHit = true;
            }
        }
    }

    return foundHit;
}


// Given a ray, returns the shaded color where the ray intersects a sphere.
// If the ray does not hit a sphere, returns the environment color.
vec4 RayTracer(Ray ray)
{
    HitInfo hit;
    if (IntersectRay(hit, ray)) {
        vec3 view = normalize(-ray.dir);
        vec3 clr = Shade(hit.mtl, hit.position, hit.normal, view);
        
        vec3 k_s = hit.mtl.k_s;
        vec3 accumulatedReflect = vec3(0.0);
        vec3 reflectFactor = k_s;

        for (int bounce = 0; bounce < MAX_BOUNCES; ++bounce) {
            if (bounce >= bounceLimit) break;
            if (dot(reflectFactor, vec3(1.0)) <= 0.0) break;

            Ray r;
            r.pos = hit.position + 0.001 * hit.normal; // avoid self-intersection
            r.dir = reflect(ray.dir, hit.normal);

            HitInfo h;
            if (IntersectRay(h, r)) {
                vec3 viewDir = normalize(-r.dir);
                vec3 localClr = Shade(h.mtl, h.position, h.normal, viewDir);
                accumulatedReflect += reflectFactor * localClr;

                reflectFactor *= h.mtl.k_s;
                hit = h;
            } else {
                accumulatedReflect += reflectFactor * textureCube(envMap, r.dir.xzy).rgb;
                break;
            }
        }

        clr += accumulatedReflect;
        return vec4(clr, 1.0);
    } else {
        return vec4(textureCube(envMap, ray.dir.xzy).rgb, 0.0);
    }
}
`;
*/ 

/* middle claude 
var raytraceFS = `
struct Ray {
	vec3 pos;
	vec3 dir;
};

struct Material {
	vec3  k_d;	// diffuse coefficient
	vec3  k_s;	// specular coefficient
	float n;	// specular exponent
};

struct Sphere {
	vec3     center;
	float    radius;
	Material mtl;
};

struct Light {
	vec3 position;
	vec3 intensity;
};

struct HitInfo {
	float    t;
	vec3     position;
	vec3     normal;
	Material mtl;
};

uniform Sphere spheres[ NUM_SPHERES ];
uniform Light  lights [ NUM_LIGHTS  ];
uniform samplerCube envMap;
uniform int bounceLimit;

bool IntersectRay( inout HitInfo hit, Ray ray );

// Shades the given point and returns the computed color.
// This function is used in both pure ray tracing and hybrid modes
vec3 Shade(Material mtl, vec3 position, vec3 normal, vec3 view)
{
    vec3 color = vec3(0.0);
    
    for (int i = 0; i < NUM_LIGHTS; ++i) {
        vec3 lightDir = normalize(lights[i].position - position);
        float lightDist = length(lights[i].position - position);
        
        // Shadow check using ray tracing
        Ray shadowRay;
        shadowRay.pos = position + 0.001 * normal;  // small bias to avoid self-intersection
        shadowRay.dir = lightDir;
        
        HitInfo shadowHit;
        bool inShadow = false;
        
        // Cast shadow ray and check if it hits anything before reaching the light
        if (IntersectRay(shadowHit, shadowRay) && shadowHit.t < lightDist - 0.001) {
            inShadow = true;
        }
        
        // Only apply lighting if not in shadow
        if (!inShadow) {
            // Diffuse term (Lambert)
            float diff = max(dot(normal, lightDir), 0.0);
            vec3 diffuse = mtl.k_d * lights[i].intensity * diff;

            // Specular term (Blinn-Phong)
            vec3 halfVec = normalize(lightDir + view);
            float spec = pow(max(dot(normal, halfVec), 0.0), mtl.n);
            vec3 specular = mtl.k_s * lights[i].intensity * spec;

            color += diffuse + specular;
        }
    }
    
    return color;
}

// Intersects the given ray with all spheres in the scene
// and updates the given HitInfo using the information of the sphere
// that first intersects with the ray.
// Returns true if an intersection is found.
bool IntersectRay( inout HitInfo hit, Ray ray )
{
    hit.t = 1e30;
    bool foundHit = false;
    
    for (int i = 0; i < NUM_SPHERES; ++i) {
        Sphere sphere = spheres[i];
        vec3 oc = ray.pos - sphere.center;
        
        float a = dot(ray.dir, ray.dir);
        float b = 2.0 * dot(oc, ray.dir);
        float c = dot(oc, oc) - sphere.radius * sphere.radius;
        
        float discriminant = b*b - 4.0*a*c;
        if (discriminant >= 0.0) {
            float sqrtDisc = sqrt(discriminant);
            float t1 = (-b - sqrtDisc) / (2.0 * a);
            float t2 = (-b + sqrtDisc) / (2.0 * a);
            
            // Choose the closest positive intersection
            float t = (t1 > 0.001) ? t1 : ((t2 > 0.001) ? t2 : -1.0);
            
            if (t > 0.001 && t < hit.t) {
                hit.t = t;
                hit.position = ray.pos + t * ray.dir;
                hit.normal = normalize(hit.position - sphere.center);
                hit.mtl = sphere.mtl;
                foundHit = true;
            }
        }
    }

    return foundHit;
}

// Given a ray, returns the shaded color where the ray intersects a sphere.
// If the ray does not hit a sphere, returns the environment color.
// This function works for both pure ray tracing and hybrid modes
vec4 RayTracer(Ray ray)
{
    HitInfo hit;
    if (IntersectRay(hit, ray)) {
        vec3 view = normalize(-ray.dir);
        vec3 clr = Shade(hit.mtl, hit.position, hit.normal, view);
        
        // Compute reflections using ray tracing
        vec3 reflectFactor = hit.mtl.k_s;
        Ray currentRay = ray;
        HitInfo currentHit = hit;

        for (int bounce = 0; bounce < MAX_BOUNCES; ++bounce) {
            if (bounce >= bounceLimit) break;
            if (reflectFactor.r + reflectFactor.g + reflectFactor.b <= 0.001) break;

            // Create reflection ray
            Ray reflectRay;
            reflectRay.pos = currentHit.position + 0.001 * currentHit.normal; // avoid self-intersection
            reflectRay.dir = reflect(currentRay.dir, currentHit.normal);

            HitInfo reflectHit;
            if (IntersectRay(reflectHit, reflectRay)) {
                // Hit another sphere, shade it
                vec3 reflectView = normalize(-reflectRay.dir);
                vec3 reflectColor = Shade(reflectHit.mtl, reflectHit.position, reflectHit.normal, reflectView);
                
                clr += reflectFactor * reflectColor;
                
                // Update for next bounce
                reflectFactor *= reflectHit.mtl.k_s;
                currentRay = reflectRay;
                currentHit = reflectHit;
            } else {
                // Hit environment, use environment map
                vec3 envColor = textureCube(envMap, reflectRay.dir.xzy).rgb;
                clr += reflectFactor * envColor;
                break; // No more bounces needed
            }
        }

        return vec4(clr, 1.0);
    } else {
        // Ray didn't hit anything, return environment color
        return vec4(textureCube(envMap, ray.dir.xzy).rgb, 0.0);
    }
}
`;
*/ 

/*
var raytraceFS = `
struct Ray {
	vec3 pos;
	vec3 dir;
};

struct Material {
	vec3  k_d;	// diffuse coefficient
	vec3  k_s;	// specular coefficient
	float n;	// specular exponent
};

struct Sphere {
	vec3     center;
	float    radius;
	Material mtl;
};

struct Light {
	vec3 position;
	vec3 intensity;
};

struct HitInfo {
	float    t;
	vec3     position;
	vec3     normal;
	Material mtl;
};

uniform Sphere spheres[ NUM_SPHERES ];
uniform Light  lights [ NUM_LIGHTS  ];
uniform samplerCube envMap;
uniform int bounceLimit;

bool IntersectRay( inout HitInfo hit, Ray ray );

// Shades the given point and returns the computed color.
// This function is used in both pure ray tracing and hybrid modes
vec3 Shade(Material mtl, vec3 position, vec3 normal, vec3 view)
{
    vec3 color = vec3(0.0);
    
    for (int i = 0; i < NUM_LIGHTS; ++i) {
        vec3 lightDir = normalize(lights[i].position - position);
        float lightDist = length(lights[i].position - position);
        
        // Shadow check using ray tracing
        Ray shadowRay;
        shadowRay.pos = position + 0.001 * normal;  // small bias to avoid self-intersection
        shadowRay.dir = lightDir;
        
        HitInfo shadowHit;
        bool inShadow = false;
        
        // Cast shadow ray and check if it hits anything before reaching the light
        if (IntersectRay(shadowHit, shadowRay) && shadowHit.t < lightDist - 0.001) {
            inShadow = true;
        }
        
        // Apply lighting (with or without shadows based on mode)
        // Diffuse term (Lambert)
        float diff = max(dot(normal, lightDir), 0.0);
        vec3 diffuse = mtl.k_d * lights[i].intensity * diff;

        // Specular term (Blinn-Phong)
        vec3 halfVec = normalize(lightDir + view);
        float spec = pow(max(dot(normal, halfVec), 0.0), mtl.n);
        vec3 specular = mtl.k_s * lights[i].intensity * spec;

        // In hybrid mode, apply shadow factor; in pure ray tracing, full shadow or no shadow
        if (!inShadow) {
            color += diffuse + specular;
        }
        // If in shadow, we add nothing (full shadow)
    }
    
    return color;
}

// Intersects the given ray with all spheres in the scene
// and updates the given HitInfo using the information of the sphere
// that first intersects with the ray.
// Returns true if an intersection is found.
bool IntersectRay( inout HitInfo hit, Ray ray )
{
    hit.t = 1e30;
    bool foundHit = false;
    
    for (int i = 0; i < NUM_SPHERES; ++i) {
        Sphere sphere = spheres[i];
        vec3 oc = ray.pos - sphere.center;
        
        float a = dot(ray.dir, ray.dir);
        float b = 2.0 * dot(oc, ray.dir);
        float c = dot(oc, oc) - sphere.radius * sphere.radius;
        
        float discriminant = b*b - 4.0*a*c;
        if (discriminant >= 0.0) {
            float sqrtDisc = sqrt(discriminant);
            float t1 = (-b - sqrtDisc) / (2.0 * a);
            float t2 = (-b + sqrtDisc) / (2.0 * a);
            
            // Choose the closest positive intersection
            float t = (t1 > 0.001) ? t1 : ((t2 > 0.001) ? t2 : -1.0);
            
            if (t > 0.001 && t < hit.t) {
                hit.t = t;
                hit.position = ray.pos + t * ray.dir;
                hit.normal = normalize(hit.position - sphere.center);
                hit.mtl = sphere.mtl;
                foundHit = true;
            }
        }
    }

    return foundHit;
}

// Given a ray, returns the shaded color where the ray intersects a sphere.
// If the ray does not hit a sphere, returns the environment color.
// This function works for both pure ray tracing and hybrid modes
vec4 RayTracer(Ray ray)
{
    HitInfo hit;
    if (IntersectRay(hit, ray)) {
        vec3 view = normalize(-ray.dir);
        vec3 clr = Shade(hit.mtl, hit.position, hit.normal, view);
        
        // Compute reflections using ray tracing
        vec3 reflectFactor = hit.mtl.k_s;
        Ray currentRay = ray;
        HitInfo currentHit = hit;

        for (int bounce = 0; bounce < MAX_BOUNCES; ++bounce) {
            if (bounce >= bounceLimit) break;
            if (reflectFactor.r + reflectFactor.g + reflectFactor.b <= 0.001) break;

            // Create reflection ray
            Ray reflectRay;
            reflectRay.pos = currentHit.position + 0.001 * currentHit.normal; // avoid self-intersection
            reflectRay.dir = reflect(currentRay.dir, currentHit.normal);

            HitInfo reflectHit;
            if (IntersectRay(reflectHit, reflectRay)) {
                // Hit another sphere, shade it
                vec3 reflectView = normalize(-reflectRay.dir);
                vec3 reflectColor = Shade(reflectHit.mtl, reflectHit.position, reflectHit.normal, reflectView);
                
                clr += reflectFactor * reflectColor;
                
                // Update for next bounce
                reflectFactor *= reflectHit.mtl.k_s;
                currentRay = reflectRay;
                currentHit = reflectHit;
            } else {
                // Hit environment, use environment map
                vec3 envColor = textureCube(envMap, reflectRay.dir.xzy).rgb;
                clr += reflectFactor * envColor;
                break; // No more bounces needed
            }
        }

        return vec4(clr, 1.0);
    } else {
        // Ray didn't hit anything, return environment color
        return vec4(textureCube(envMap, ray.dir.xzy).rgb, 0.0);
    }
}
`;
*/

/*
var raytraceFS = `
struct Ray {
    vec3 pos;
    vec3 dir;
};

struct Material {
    vec3 k_d; // Diffuse
    vec3 k_s; // Specular
    float n;  // Shininess
};

struct Sphere {
    vec3 center;
    float radius;
    Material mtl;
};

struct Light {
    vec3 position;
    vec3 intensity;
};

struct HitInfo {
    float t;
    vec3 position;
    vec3 normal;
    Material mtl;
};

uniform Sphere spheres[NUM_SPHERES];
uniform Light lights[NUM_LIGHTS];
uniform samplerCube envMap;
uniform int bounceLimit;

bool IntersectRay(inout HitInfo hit, Ray ray)
{
    hit.t = 1e30;
    bool foundHit = false;

    for (int i = 0; i < NUM_SPHERES; ++i) {
        Sphere sphere = spheres[i];
        vec3 oc = ray.pos - sphere.center;

        float a = dot(ray.dir, ray.dir);
        float b = 2.0 * dot(oc, ray.dir);
        float c = dot(oc, oc) - sphere.radius * sphere.radius;

        float discriminant = b * b - 4.0 * a * c;
        if (discriminant >= 0.0) {
            float sqrtDisc = sqrt(discriminant);
            float t1 = (-b - sqrtDisc) / (2.0 * a);
            float t2 = (-b + sqrtDisc) / (2.0 * a);

            float t = (t1 > 0.001) ? t1 : ((t2 > 0.001) ? t2 : -1.0);
            if (t > 0.001 && t < hit.t) {
                hit.t = t;
                hit.position = ray.pos + t * ray.dir;
                hit.normal = normalize(hit.position - sphere.center);
                hit.mtl = sphere.mtl;
                foundHit = true;
            }
        }
    }

    return foundHit;
}

vec3 Shade(Material mtl, vec3 position, vec3 normal, vec3 view)
{
    vec3 color = vec3(0.0);

    for (int i = 0; i < NUM_LIGHTS; ++i) {
        vec3 lightDir = normalize(lights[i].position - position);
        float lightDist = length(lights[i].position - position);

        Ray shadowRay;
        shadowRay.pos = position + 0.001 * normal;
        shadowRay.dir = lightDir;

        HitInfo shadowHit;
        bool inShadow = false;

        if (IntersectRay(shadowHit, shadowRay) && shadowHit.t < lightDist - 0.001) {
            inShadow = true;
        }

        if (!inShadow) {
            float diff = max(dot(normal, lightDir), 0.0);
            vec3 diffuse = mtl.k_d * lights[i].intensity * diff;

            vec3 halfVec = normalize(lightDir + view);
            float spec = pow(max(dot(normal, halfVec), 0.0), mtl.n);
            vec3 specular = mtl.k_s * lights[i].intensity * spec;

            color += diffuse + specular;
        }
    }

    return color;
}

vec4 RayTracer(Ray ray)
{
    // Detect hybrid mode via bounceLimit == 0, and lower the ray origin
    if (bounceLimit == 0) {
        ray.pos.y -= 0.05; // Lower the horizon ONLY for Rasterization + Ray Tracing
    }

    HitInfo hit;
    if (IntersectRay(hit, ray)) {
        vec3 view = normalize(-ray.dir);
        vec3 clr = Shade(hit.mtl, hit.position, hit.normal, view);

        vec3 reflectFactor = hit.mtl.k_s;
        Ray currentRay = ray;
        HitInfo currentHit = hit;

        for (int bounce = 0; bounce < MAX_BOUNCES; ++bounce) {
            if (bounce >= bounceLimit) break;
            if (reflectFactor.r + reflectFactor.g + reflectFactor.b <= 0.001) break;

            Ray reflectRay;
            reflectRay.pos = currentHit.position + 0.001 * currentHit.normal;
            reflectRay.dir = reflect(currentRay.dir, currentHit.normal);

            HitInfo reflectHit;
            if (IntersectRay(reflectHit, reflectRay)) {
                vec3 reflectView = normalize(-reflectRay.dir);
                vec3 reflectColor = Shade(reflectHit.mtl, reflectHit.position, reflectHit.normal, reflectView);

                clr += reflectFactor * reflectColor;
                reflectFactor *= reflectHit.mtl.k_s;

                currentRay = reflectRay;
                currentHit = reflectHit;
            } else {
                vec3 envColor = textureCube(envMap, reflectRay.dir.xzy).rgb;
                clr += reflectFactor * envColor;
                break;
            }
        }

        return vec4(clr, 1.0);
    } else {
        return vec4(textureCube(envMap, ray.dir.xzy).rgb, 0.0);
    }
}
`;
*/  // maybe 




var raytraceFS = `
struct Ray {
    vec3 pos;
    vec3 dir;
};

struct Material {
    vec3 k_d;
    vec3 k_s;
    float n;
};

struct Sphere {
    vec3 center;
    float radius;
    Material mtl;
};

struct Light {
    vec3 position;
    vec3 intensity;
};

struct HitInfo {
    float t;
    vec3 position;
    vec3 normal;
    Material mtl;
};

uniform Sphere spheres[NUM_SPHERES];
uniform Light lights[NUM_LIGHTS];
uniform samplerCube envMap;
uniform int bounceLimit;

const float epsilon = 0.001;

bool IntersectRay(inout HitInfo hit, Ray ray) {
    hit.t = 1e30;
    bool foundHit = false;

    for (int i = 0; i < NUM_SPHERES; ++i) {
        Sphere sphere = spheres[i];
        vec3 oc = ray.pos - sphere.center;

        float a = dot(ray.dir, ray.dir);
        float b = 2.0 * dot(oc, ray.dir);
        float c = dot(oc, oc) - sphere.radius * sphere.radius;

        float discriminant = b * b - 4.0 * a * c;
        if (discriminant >= 0.0) {
            float sqrtDisc = sqrt(discriminant);
            float t1 = (-b - sqrtDisc) / (2.0 * a);
            float t2 = (-b + sqrtDisc) / (2.0 * a);

            float t = (t1 > epsilon) ? t1 : ((t2 > epsilon) ? t2 : -1.0);
            if (t > epsilon && t < hit.t) {
                hit.t = t;
                hit.position = ray.pos + t * ray.dir;
                hit.normal = normalize(hit.position - sphere.center);
                hit.mtl = sphere.mtl;
                foundHit = true;
            }
        }
    }

    return foundHit;
}

vec3 Shade(Material mtl, vec3 position, vec3 normal, vec3 view) {
    vec3 color = vec3(0.0);

    for (int i = 0; i < NUM_LIGHTS; ++i) {
        vec3 lightDir = normalize(lights[i].position - position);
        float lightDist = length(lights[i].position - position);

        Ray shadowRay;
        shadowRay.pos = position + epsilon * normal;
        shadowRay.dir = lightDir;

        HitInfo shadowHit;
        bool inShadow = false;

        if (IntersectRay(shadowHit, shadowRay) && shadowHit.t < lightDist - epsilon) {
            inShadow = true;
        }

        if (!inShadow) {
            float diff = max(dot(normal, lightDir), 0.0);
            vec3 diffuse = mtl.k_d * lights[i].intensity * diff;

            vec3 halfVec = normalize(lightDir + view);
            float spec = pow(max(dot(normal, halfVec), 0.0), mtl.n);
            vec3 specular = mtl.k_s * lights[i].intensity * spec;

            color += diffuse + specular;
        }
    }

    return color;
}

vec4 RayTracer(Ray ray) {
    // Infer hybrid mode via bounceLimit == 0 and apply a minimal offset to avoid horizon mismatch
    vec3 originalPos = ray.pos;
    ray.pos += epsilon * ray.dir;

    HitInfo hit;
    if (IntersectRay(hit, ray)) {
        vec3 view = normalize(-ray.dir);
        vec3 clr = Shade(hit.mtl, hit.position, hit.normal, view);

        vec3 reflectFactor = hit.mtl.k_s;
        Ray currentRay = ray;
        HitInfo currentHit = hit;

        for (int bounce = 0; bounce < MAX_BOUNCES; ++bounce) {
            if (bounce >= bounceLimit) break;
            if (reflectFactor.r + reflectFactor.g + reflectFactor.b <= 0.001) break;

            Ray reflectRay;
            reflectRay.pos = currentHit.position + epsilon * currentHit.normal;
            reflectRay.dir = reflect(currentRay.dir, currentHit.normal);

            HitInfo reflectHit;
            if (IntersectRay(reflectHit, reflectRay)) {
                vec3 reflectView = normalize(-reflectRay.dir);
                vec3 reflectColor = Shade(reflectHit.mtl, reflectHit.position, reflectHit.normal, reflectView);

                clr += reflectFactor * reflectColor;
                reflectFactor *= reflectHit.mtl.k_s;

                currentRay = reflectRay;
                currentHit = reflectHit;
            } else {
                vec3 envColor = textureCube(envMap, reflectRay.dir.xzy).rgb;
                clr += reflectFactor * envColor;
                break;
            }
        }

        return vec4(clr, 1.0);
    } else {
        return vec4(textureCube(envMap, ray.dir.xzy).rgb, 0.0);
    }
}`;







/*
var raytraceFS = `
struct Ray {
	vec3 pos;
	vec3 dir;
};

struct Material {
	vec3  k_d;
	vec3  k_s;
	float n;
};

struct Sphere {
	vec3     center;
	float    radius;
	Material mtl;
};

struct Light {
	vec3 position;
	vec3 intensity;
};

struct HitInfo {
	float    t;
	vec3     position;
	vec3     normal;
	Material mtl;
};

uniform Sphere spheres[ NUM_SPHERES ];
uniform Light  lights [ NUM_LIGHTS  ];
uniform samplerCube envMap;
uniform int bounceLimit;

bool IntersectRay( inout HitInfo hit, Ray ray ) {
	hit.t = 1e30;
	bool foundHit = false;

	for (int i = 0; i < NUM_SPHERES; ++i) {
		Sphere sphere = spheres[i];
		vec3 oc = ray.pos - sphere.center;

		float a = dot(ray.dir, ray.dir);
		float b = 2.0 * dot(oc, ray.dir);
		float c = dot(oc, oc) - sphere.radius * sphere.radius;

		float discriminant = b*b - 4.0*a*c;
		if (discriminant > 0.0) {
			float sqrtDisc = sqrt(discriminant);
			float t1 = (-b - sqrtDisc) / (2.0 * a);
			float t2 = (-b + sqrtDisc) / (2.0 * a);

			float t = (t1 > 0.0) ? t1 : ((t2 > 0.0) ? t2 : -1.0);
			if (t > 0.0 && t < hit.t) {
				hit.t = t;
				hit.position = ray.pos + t * ray.dir;
				hit.normal = normalize(hit.position - sphere.center);
				hit.mtl = sphere.mtl;
				foundHit = true;
			}
		}
	}
	return foundHit;
}

vec3 Shade(Material mtl, vec3 position, vec3 normal, vec3 view) {
	vec3 color = vec3(0.0);
	for (int i = 0; i < NUM_LIGHTS; ++i) {
		vec3 lightDir = normalize(lights[i].position - position);
		Ray shadowRay;
		shadowRay.pos = position + 0.001 * normal;
		shadowRay.dir = lightDir;

		HitInfo shadowHit;
		bool inShadow = IntersectRay(shadowHit, shadowRay);
		float lightDist = length(lights[i].position - position);

		if (inShadow && shadowHit.t < lightDist) {
			continue;
		}

		float diff = max(dot(normal, lightDir), 0.0);
		vec3 diffuse = mtl.k_d * lights[i].intensity * diff;

		vec3 halfVec = normalize(lightDir + view);
		float spec = pow(max(dot(normal, halfVec), 0.0), mtl.n);
		vec3 specular = mtl.k_s * lights[i].intensity * spec;

		color += diffuse + specular;
	}
	return color;
}

vec4 RayTracer(Ray ray) {
	HitInfo hit;
	if (IntersectRay(hit, ray)) {
		vec3 view = normalize(-ray.dir);
		vec3 clr = Shade(hit.mtl, hit.position, hit.normal, view);

		vec3 k_s = hit.mtl.k_s;
		vec3 accumulatedReflect = vec3(0.0);
		vec3 reflectFactor = k_s;

		for (int bounce = 0; bounce < MAX_BOUNCES; ++bounce) {
			if (bounce >= bounceLimit) break;
			if (dot(reflectFactor, vec3(1.0)) <= 0.0) break;

			Ray r;
			r.pos = hit.position + 0.001 * hit.normal;
			r.dir = reflect(ray.dir, hit.normal);

			HitInfo h;
			if (IntersectRay(h, r)) {
				vec3 viewDir = normalize(-r.dir);
				vec3 localClr = Shade(h.mtl, h.position, h.normal, viewDir);
				accumulatedReflect += reflectFactor * localClr;

				reflectFactor *= h.mtl.k_s;
				hit = h;
				ray = r;
			} else {
				accumulatedReflect += reflectFactor * textureCube(envMap, r.dir.xzy).rgb;
				break;
			}
		}

		clr += accumulatedReflect;
		return vec4(clr, 1.0);
	} else {
		return vec4(textureCube(envMap, ray.dir.xzy).rgb, 1.0);
	}
}
`;
*/  



/* claude 
var raytraceFS = `
struct Ray {
 vec3 pos;
 vec3 dir;
};
struct Material {
 vec3  k_d;  // diffuse coefficient
 vec3  k_s;  // specular coefficient
 float n;    // specular exponent
};
struct Sphere {
 vec3     center;
 float    radius;
 Material mtl;
};
struct Light {
 vec3 position;
 vec3 intensity;
};
struct HitInfo {
 float    t;
 vec3     position;
 vec3     normal;
 Material mtl;
};
uniform Sphere spheres[ NUM_SPHERES ];
uniform Light  lights [ NUM_LIGHTS  ];
uniform samplerCube envMap;
uniform int bounceLimit;

bool IntersectRay( inout HitInfo hit, Ray ray );

// Shades the given point and returns the computed color.
vec3 Shade( Material mtl, vec3 position, vec3 normal, vec3 view )
{
 vec3 color = vec3(0,0,0);
 for ( int i=0; i<NUM_LIGHTS; ++i ) {
     // Check for shadows
     Ray shadowRay;
     shadowRay.pos = position + normal * 0.001; // offset to avoid self-intersection
     shadowRay.dir = normalize(lights[i].position - position);
     
     float lightDistance = length(lights[i].position - position);
     
     HitInfo shadowHit;
     bool inShadow = false;
     
     // Check if shadow ray intersects any sphere before reaching the light
     if (IntersectRay(shadowHit, shadowRay) && shadowHit.t < lightDistance) {
         inShadow = true;
     }
     
     // If not shadowed, perform shading using the Blinn model
     if (!inShadow) {
         vec3 lightDir = normalize(lights[i].position - position);
         vec3 halfVector = normalize(lightDir + view);
         
         // Diffuse component
         float diffuse = max(dot(normal, lightDir), 0.0);
         
         // Specular component (Blinn-Phong)
         float specular = pow(max(dot(normal, halfVector), 0.0), mtl.n);
         
         color += (mtl.k_d * diffuse + mtl.k_s * specular) * lights[i].intensity;
     }
 }
 return color;
}

// Intersects the given ray with all spheres in the scene
// and updates the given HitInfo using the information of the sphere
// that first intersects with the ray.
// Returns true if an intersection is found.
bool IntersectRay( inout HitInfo hit, Ray ray )
{
 hit.t = 1e30;
 bool foundHit = false;
 for ( int i=0; i<NUM_SPHERES; ++i ) {
     // Test for ray-sphere intersection
     vec3 oc = ray.pos - spheres[i].center;
     float a = dot(ray.dir, ray.dir);
     float b = 2.0 * dot(oc, ray.dir);
     float c = dot(oc, oc) - spheres[i].radius * spheres[i].radius;
     
     float discriminant = b * b - 4.0 * a * c;
     
     if (discriminant >= 0.0) {
         float t1 = (-b - sqrt(discriminant)) / (2.0 * a);
         float t2 = (-b + sqrt(discriminant)) / (2.0 * a);
         
         float t = (t1 > 0.001) ? t1 : t2; // Use closest positive intersection
         
         // If intersection is found and closer than previous hits, update HitInfo
         if (t > 0.001 && t < hit.t) {
             hit.t = t;
             hit.position = ray.pos + t * ray.dir;
             hit.normal = normalize(hit.position - spheres[i].center);
             hit.mtl = spheres[i].mtl;
             foundHit = true;
         }
     }
 }
 return foundHit;
}

// Given a ray, returns the shaded color where the ray intersects a sphere.
// If the ray does not hit a sphere, returns the environment color.
vec4 RayTracer( Ray ray )
{
 HitInfo hit;
 if ( IntersectRay( hit, ray ) ) {
     vec3 view = normalize( -ray.dir );
     vec3 clr = Shade( hit.mtl, hit.position, hit.normal, view );
      
     // Compute reflections
     vec3 k_s = hit.mtl.k_s;
     for ( int bounce=0; bounce<MAX_BOUNCES; ++bounce ) {
         if ( bounce >= bounceLimit ) break;
         if ( hit.mtl.k_s.r + hit.mtl.k_s.g + hit.mtl.k_s.b <= 0.0 ) break;
          
         Ray r;  // this is the reflection ray
         HitInfo h;  // reflection hit info
          
         // Initialize the reflection ray
         r.pos = hit.position + hit.normal * 0.001; // offset to avoid self-intersection
         r.dir = reflect(ray.dir, hit.normal);
          
         if ( IntersectRay( h, r ) ) {
             // Hit found, so shade the hit point
             vec3 reflectionView = normalize(-r.dir);
             vec3 reflectionColor = Shade(h.mtl, h.position, h.normal, reflectionView);
             clr += k_s * reflectionColor;
             
             // Update the loop variables for tracing the next reflection ray
             ray = r;
             hit = h;
             view = reflectionView;
             k_s *= h.mtl.k_s; // attenuate reflection coefficient
         } else {
             // The reflection ray did not intersect with anything,
             // so we are using the environment color
             clr += k_s * textureCube( envMap, r.dir.xzy ).rgb;
             break;  // no more reflections
         }
     }
     return vec4( clr, 1 );  // return the accumulated color, including the reflections
 } else {
     return vec4( textureCube( envMap, ray.dir.xzy ).rgb, 0 );   // return the environment color
 }
}
`;
*/








/* don't know  
var raytraceFS = `
struct Ray {
	vec3 pos;
	vec3 dir;
};

struct Material {
	vec3  k_d;	// diffuse coefficient
	vec3  k_s;	// specular coefficient
	float n;	// specular exponent
};

struct Sphere {
	vec3     center;
	float    radius;
	Material mtl;
};

struct Light {
	vec3 position;
	vec3 intensity;
};

struct HitInfo {
	float    t;
	vec3     position;
	vec3     normal;
	Material mtl;
};

uniform Sphere spheres[ NUM_SPHERES ];
uniform Light  lights [ NUM_LIGHTS  ];
uniform samplerCube envMap;
uniform int bounceLimit;


bool IntersectShadowRay(Ray ray){
	
	bool foundHit = false;
	for ( int i=0; i<NUM_SPHERES; ++i ) {
		Sphere sphere = spheres[i];

		// TO-DO: Test for ray-sphere intersection
		float discriminant = pow(dot(ray.dir, (ray.pos - sphere.center)), 2.0) - 
			(dot(ray.dir, ray.dir) * (dot((ray.pos - sphere.center), (ray.pos - sphere.center)) - pow(sphere.radius, 2.0))); 

		if(discriminant >= 0.0){
			foundHit = true; 
		}

		// find the t value of closet ray-sphere intersection
		float tVal = ((-1.0 * dot(ray.dir, (ray.pos-sphere.center))) - sqrt(discriminant)) / (dot(ray.dir, ray.dir));
		if(tVal < 0.0){
			foundHit = false;
		}
		
		if(foundHit){
			return foundHit;
		}	
	}
	return foundHit;
}

// Intersects the given ray with all spheres in the scene
// and updates the given HitInfo using the information of the sphere
// that first intersects with the ray.
// Returns true if an intersection is found.
bool IntersectRay( inout HitInfo hit, Ray ray )
{
	hit.t = 1e30;
	bool foundHit = false;

	for ( int i=0; i<NUM_SPHERES; ++i ) {
		Sphere sphere = spheres[i];

		// TO-DO: Test for ray-sphere intersection
		float discriminant = pow(dot(ray.dir, (ray.pos - sphere.center)), 2.0) - 
			(dot(ray.dir, ray.dir) * (dot((ray.pos - sphere.center), (ray.pos - sphere.center)) - pow(sphere.radius, 2.0))); 

		if(discriminant >= 0.0){ // hit found

			// find the t value of closet ray-sphere intersection
			float t0 = (-(dot(ray.dir, (ray.pos-sphere.center))) - sqrt(discriminant)) / (dot(ray.dir, ray.dir));

			// TO-DO: If intersection is found, update the given HitInfo
			if( t0 > 0.0 && t0 <= hit.t){
				foundHit = true;

				hit.t = t0; 
				hit.position = ray.pos + (ray.dir * t0) ; 
				hit.normal = normalize((hit.position - sphere.center)/sphere.radius); 
	
				hit.mtl = sphere.mtl;
			}	
	
		}
		
	}
	return foundHit;
}

// Shades the given point and returns the computed color.
vec3 Shade( Material mtl, vec3 position, vec3 normal, vec3 view )
{
	float eplison = 0.003;
	vec3 ambientComponent = mtl.k_d * 0.05;
	vec3 color;
	normal = normalize(normal);

	for ( int i=0; i<NUM_LIGHTS; ++i ) {
		
		// TO-DO: Check for shadows
		Ray surfaceToLightRay; 
		surfaceToLightRay.dir = normalize(lights[i].position - position);
		surfaceToLightRay.pos = position + (surfaceToLightRay.dir) * eplison;  

		if( IntersectShadowRay(surfaceToLightRay) ){
			// color += vec3(1.0,0.0,0.0);	// Test Shadows
			color += ambientComponent;
		}else{
			// TO-DO: If not shadowed, perform shading using the Blinn model
			vec3 lightDir = normalize((lights[i].position - position));
			float cosTheta = dot(normal, lightDir);
			vec3 diffuseComponent = mtl.k_d * lights[i].intensity * max(0.0, cosTheta); 
			
			vec3 halfAngle = normalize(view + lightDir);
			vec3 specularComponent = mtl.k_s * lights[i].intensity * pow(max(0.0, dot(normal, halfAngle)),mtl.n); 
			
			color += ambientComponent + diffuseComponent + specularComponent;	// change this line	
		}
	}
	return color;
}

// Given a ray, returns the shaded color where the ray intersects a sphere.
// If the ray does not hit a sphere, returns the environment color.
vec4 RayTracer( Ray ray )
{
	HitInfo hit;
	if ( IntersectRay( hit, ray ) ) {
		vec3 view = normalize( -ray.dir );
		vec3 clr = Shade( hit.mtl, hit.position, hit.normal, view );
		
		// Compute reflections
		vec3 k_s = hit.mtl.k_s;
		for ( int bounce=0; bounce<MAX_BOUNCES; ++bounce ) {
			if ( bounce >= bounceLimit ) break;
			if ( hit.mtl.k_s.r + hit.mtl.k_s.g + hit.mtl.k_s.b <= 0.0 ) break;
			
			Ray r;	// this is the reflection ray
			HitInfo h;	// reflection hit info
			
			// TO-DO: Initialize the reflection ray
			r.dir = normalize(ray.dir) - 2.0 * (dot(normalize(ray.dir), hit.normal))* hit.normal;
			r.pos = hit.position + (r.dir) * 0.0001;

			
			if ( IntersectRay( h, r ) ) {
				// TO-DO: Hit found, so shade the hit point
				// clr += vec3(h.normal); // Test reflection intersections
				// clr += vec3(1.0, 0.0, 0.0);
				clr += Shade(h.mtl, h.position, h.normal, view);
				
				// TO-DO: Update the loop variables for tracing the next reflection ray
				hit = h;
				ray = r;					
			} else {
				// The refleciton ray did not intersect with anything,
				// so we are using the environment color
				clr += k_s * textureCube( envMap, r.dir.xzy ).rgb;
				break;	// no more reflections
			}
		}
		
		return vec4( clr, 1 );	// return the accumulated color, including the reflections
	} else {
		return vec4( textureCube( envMap, ray.dir.xzy ).rgb, 0 );	// return the environment color
	}
}
`;
*/ 
