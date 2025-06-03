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

// === Shadow Ray Intersection (optimized for shadows only) ===
bool IntersectShadowRay(Ray ray) {
    for (int i = 0; i < NUM_SPHERES; ++i) {
        Sphere sphere = spheres[i];
        vec3 oc = ray.pos - sphere.center;
        
        float a = dot(ray.dir, ray.dir);
        float b = 2.0 * dot(oc, ray.dir);
        float c = dot(oc, oc) - sphere.radius * sphere.radius;
        
        float discriminant = b*b - 4.0*a*c;
        if (discriminant >= 0.0) {
            float sqrtDisc = sqrt(discriminant);
            float t = (-b - sqrtDisc) / (2.0 * a);
            if (t > 0.0) {
                return true;
            }
        }
    }
    return false;
}

// === Ray-Sphere Intersection ===
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
            float t = (-b - sqrtDisc) / (2.0 * a);
            
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

// === Shade Function with Shadow Checks ===
vec3 Shade(Material mtl, vec3 position, vec3 normal, vec3 view)
{
    float epsilon = 0.003;
    vec3 ambientComponent = mtl.k_d * 0.05;
    vec3 color = vec3(0.0);
    normal = normalize(normal);
    
    for (int i = 0; i < NUM_LIGHTS; ++i) {
        // Shadow check
        Ray shadowRay;
        shadowRay.dir = normalize(lights[i].position - position);
        shadowRay.pos = position + shadowRay.dir * epsilon;
        
        if (IntersectShadowRay(shadowRay)) {
            // In shadow - only add ambient
            color += ambientComponent;
        } else {
            // Not in shadow - perform full Blinn-Phong shading
            vec3 lightDir = normalize(lights[i].position - position);
            float cosTheta = dot(normal, lightDir);
            vec3 diffuseComponent = mtl.k_d * lights[i].intensity * max(0.0, cosTheta);
            
            vec3 halfAngle = normalize(view + lightDir);
            vec3 specularComponent = mtl.k_s * lights[i].intensity * pow(max(0.0, dot(normal, halfAngle)), mtl.n);
            
            color += ambientComponent + diffuseComponent + specularComponent;
        }
    }
    
    return color;
}

// === Full RayTracer: used in ray tracing mode ===
vec4 RayTracer(Ray ray)
{
    HitInfo hit;
    if (IntersectRay(hit, ray)) {
        vec3 view = normalize(-ray.dir);
        vec3 clr = Shade(hit.mtl, hit.position, hit.normal, view);
        
        // Compute reflections - following the working example pattern
        vec3 k_s = hit.mtl.k_s;
        for (int bounce = 0; bounce < MAX_BOUNCES; ++bounce) {
            if (bounce >= bounceLimit) break;
            if (hit.mtl.k_s.r + hit.mtl.k_s.g + hit.mtl.k_s.b <= 0.0) break;
            
            Ray r; // reflection ray
            HitInfo h; // reflection hit info
            
            // Initialize the reflection ray
            r.dir = normalize(ray.dir) - 2.0 * (dot(normalize(ray.dir), hit.normal)) * hit.normal;
            r.pos = hit.position + r.dir * 0.0001;
            
            if (IntersectRay(h, r)) {
                // Hit found, so shade the hit point
                clr += k_s * Shade(h.mtl, h.position, h.normal, view);
                
                // Update the loop variables for tracing the next reflection ray
                hit = h;
                ray = r;
                k_s *= h.mtl.k_s; // Accumulate specular coefficients
            } else {
                // The reflection ray did not intersect with anything,
                // so we are using the environment color
                clr += k_s * textureCube(envMap, r.dir.xzy).rgb;
                break; // no more reflections
            }
        }
        
        return vec4(clr, 1.0); // return the accumulated color, including the reflections
    } else {
        return vec4(textureCube(envMap, ray.dir.xzy).rgb, 0.0); // return the environment color
    }
}
`;


