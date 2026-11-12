import * as THREE from 'three';
/** Contact-hardening shadow filter for the single orthographic window light.
 * A bounded blocker search and Vogel disk filter keep contact crisp while
 * canopy shadows soften with distance. No global Three shader mutation. */
export function softenShadows(material: THREE.MeshStandardMaterial) {
    material.onBeforeCompile = shader => {
        const source = THREE.ShaderChunk.shadowmap_pars_fragment;
        const start = source.indexOf('#if defined( SHADOWMAP_TYPE_PCF )');
        const end = source.indexOf('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )', start);
        const filter = `#if defined( SHADOWMAP_TYPE_PCF )
   float blocker = 0.0;
   float blockers = 0.0;
   for (int i=0; i<16; i++) {
    float a = float(i)*2.399963;
    vec2 offset = vec2(cos(a),sin(a))*sqrt((float(i)+.5)/16.0)*.012;
    float depth = unpackRGBAToDepth(texture2D(shadowMap,shadowCoord.xy+offset));
    if(depth < shadowCoord.z-.00015){blocker+=depth;blockers+=1.0;}
   }
   shadow=1.0;
   if(blockers>0.0){
    float radius=clamp((shadowCoord.z-blocker/blockers)*.65,.0006,.018);
    shadow=0.0;
    for(int i=0;i<32;i++){
     float a=float(i)*2.399963;
     vec2 offset=vec2(cos(a),sin(a))*sqrt((float(i)+.5)/32.0)*radius;
     shadow+=texture2DCompare(shadowMap,shadowCoord.xy+offset,shadowCoord.z);
    }
    shadow/=32.0;
   }
  `;
        shader.fragmentShader = shader.fragmentShader.replace('#include <shadowmap_pars_fragment>', source.slice(0, start) + filter + source.slice(end));
    };
    material.customProgramCacheKey = () => 'upstate-contact-shadow-v1';
}
