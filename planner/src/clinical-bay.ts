import * as THREE from 'three';
export type Specialty = 'Dental' | 'Eye care' | 'Other healthcare practice';
const types: Specialty[] = ['Dental', 'Eye care', 'Other healthcare practice'];
type Joint = { node: THREE.Object3D; position: THREE.Vector3; rotation: THREE.Quaternion; axis: THREE.Vector3; operation: string; scale: THREE.Vector3; values: number[]; rest: number };
/** Local clinical articulation only. Architecture, reception and camera have no specialty owner. */
export class ClinicalBay {
    readonly joints: Joint[] = [];
    readonly supports: { node: THREE.Object3D; local: THREE.Matrix4 }[] = [];
    readonly weights = [0, 0, 1];
    private velocities = [0, 0, 0];
    private from = [0, 0, 1];
    private tangent = [0, 0, 0];
    private target = [0, 0, 1];
    private start = 0;
    private replaying = false;
    private duration = 720;
    settled = true;
    specialty: Specialty = 'Other healthcare practice';
    constructor(readonly root: THREE.Object3D) {
        root.updateMatrixWorld(true);
        root.traverse(node => {
            if (node.userData.clinical_joint) {
                const axis = node.userData.pose_axis;
                this.joints.push({node, position:node.position.clone(), rotation:node.quaternion.clone(), axis:axis === 'X' ? new THREE.Vector3(1,0,0) : axis === 'Z' ? new THREE.Vector3(0,1,0) : new THREE.Vector3(0,0,-1), operation:axis, scale:node.scale.clone(), values:Array.from(node.userData.pose_values), rest:node.userData.pose_rest});
            } else if(node.userData.supported_by) this.supports.push({node, local:node.matrix.clone()});
        });
        this.pose();
    }
    select(value: string, now: number, reduced: boolean, replay = false) {
        const specialty = types.includes(value as Specialty) ? value as Specialty : 'Other healthcare practice';
        if(specialty===this.specialty && !replay && this.target[types.indexOf(specialty)]===1) {if(reduced)this.snap();return;}
        this.sample(now);
        this.specialty=specialty;
        this.from=[...this.weights];
        // One common velocity limiter preserves zero-sum tangents and partition of unity.
        // Reversal brakes from the current velocity; it never zeroes one channel independently.
        this.target=types.map(t=>t===specialty?1:0);
        const tangents=this.velocities.map(v=>v*this.duration);
        const limits=tangents.map((v,i)=>v>0?3*(1-this.from[i])/v:v<0?-3*this.from[i]/v:1);
        const limit=Math.max(0,Math.min(1,.65/Math.max(...tangents.map(Math.abs),.001),...limits));
        this.tangent=tangents.map(v=>v*limit);
        this.start=now;this.settled=false;this.replaying=replay;
        if(reduced)this.snap();
    }
    snap(){this.weights.splice(0,3,...this.target);this.velocities=[0,0,0];this.settled=true;this.replaying=false;this.pose();}
    sample(now:number){
        if(this.settled)return;
        const t=THREE.MathUtils.clamp((now-this.start)/this.duration,0,1),h=3*t*t-2*t*t*t,dh=6*t-6*t*t;
        for(let i=0;i<3;i++){
            this.weights[i]=(1-h)*this.from[i]+h*this.target[i]+(t*t*t-2*t*t+t)*this.tangent[i];
            this.velocities[i]=(dh*(this.target[i]-this.from[i])+(3*t*t-4*t+1)*this.tangent[i])/this.duration;
        }
        // A replay is one small articulation cycle, never a scene or selection reset.
        this.pose(this.replaying?Math.sin(Math.PI*t)**2*.06:0);
        if(t===1)this.snap();
    }
    private pose(replay=0){
        for(const joint of this.joints){
            const value=joint.values.reduce((sum,v,i)=>sum+v*this.weights[i],0);
            joint.node.position.copy(joint.position);joint.node.quaternion.copy(joint.rotation);joint.node.scale.copy(joint.scale);
            if(joint.operation==='translateY')joint.node.position.addScaledVector(joint.axis,value-joint.rest);
            else if(joint.operation==='reach'||joint.operation==='telescope'){
                // Extend above the headrest, arrive in front, then lower. Reversal follows
                // the same clearance path; retargets evaluate it from continuous weights.
                const eye=this.weights[1],smooth=(v:number)=>THREE.MathUtils.smoothstep(v,0,1);
                const reach=.01+.99*smooth(eye/.8);
                const lift=.5*smooth(eye/.15)*(1-smooth((eye-.8)/.2));
                const endpoint=new THREE.Vector3(joint.position.x/joint.rest,0,joint.position.z/joint.rest);
                if(joint.operation==='reach'){joint.node.position.copy(endpoint.multiplyScalar(reach));joint.node.position.y=joint.position.y+lift;}
                else {
                    const direction=endpoint.multiplyScalar(2*reach);direction.y=lift;
                    joint.node.position.copy(direction).multiplyScalar(.5);
                    const originalLength=new THREE.Vector3(joint.position.x,0,joint.position.z).length()*2;
                    joint.node.scale.y=joint.scale.y*direction.length()/originalLength;
                    joint.node.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction.normalize());
                }
            }
            else joint.node.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(joint.axis,THREE.MathUtils.degToRad(value-joint.rest)+(joint.node.userData.clinical_joint==='legrest'?replay:0)));
        }
    }
    audit(){
        this.root.updateMatrixWorld(true);let supportError=0,penetration=0;
        for(const {node,local} of this.supports){if(!node.parent)continue;const relative=node.parent.matrixWorld.clone().invert().multiply(node.matrixWorld);supportError=Math.max(supportError,...relative.elements.map((v,i)=>Math.abs(v-local.elements[i])));}
        // Mesh vertices transformed through every joint, relative to the architectural floor.
        const inverse=this.root.matrixWorld.clone().invert();
        this.root.traverse(node=>{if(!(node instanceof THREE.Mesh)||node.parent?.name==='Bay_Architecture')return;const m=new THREE.Matrix4().multiplyMatrices(inverse,node.matrixWorld);const a=node.geometry.attributes.position;for(let i=0;i<a.count;i++){const v=new THREE.Vector3().fromBufferAttribute(a,i).applyMatrix4(m);penetration=Math.max(penetration,.065-v.y);}});
        return {specialty:this.specialty,settled:this.settled,weights:[...this.weights],supportError,penetration:Math.max(0,penetration),joints:this.joints.map(j=>({name:j.node.name,position:j.node.position.toArray(),quaternion:j.node.quaternion.toArray()}))};
    }
}
