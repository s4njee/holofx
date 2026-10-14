import{n as e}from"./profiler-Bi27xYp-.js";import{n as t,t as n}from"./uniforms-BE1XSnDx.js";import{n as r}from"./billboards-BT_4dCEv.js";var i={point:0,box:1,sphere:2,disc:3};function a(e){let[t=0,n=1,r=0]=e.direction??[0,1,0],i=Math.hypot(t,n,r)||1,[a=0,o=a]=e.lifetime??[0,0];return{shape:e.shape??`point`,center:[...e.center??[0,0,0]],extent:[...e.extent??[0,0,0]],direction:[t/i,n/i,r/i],speed:e.speed??0,spread:e.spread??0,speedJitter:e.speedJitter??0,lifetime:[a,Math.max(a,o)],scalar:e.scalar??0}}function o(e){let t=e>>>0;return()=>{t=t+1831565813>>>0;let e=t;return e=Math.imul(e^e>>>15,e|1),e^=e+Math.imul(e^e>>>7,e|61),((e^e>>>14)>>>0)/4294967296}}function s(e,t,n,r,i,o,s=0){let c=a(e),[l,u,d]=c.direction;for(let e=0;e<r;e++){let r=(s+e)*4,a=0,f=0,p=0;if(c.shape===`box`)a=(n()*2-1)*c.extent[0],f=(n()*2-1)*c.extent[1],p=(n()*2-1)*c.extent[2];else if(c.shape===`sphere`){if(t===2){let e=n()*Math.PI*2,t=Math.sqrt(n())*c.extent[0];a=Math.cos(e)*t,f=Math.sin(e)*t}else{let e=n()*2-1,t=n()*Math.PI*2,r=Math.sqrt(Math.max(1-e*e,0)),i=Math.cbrt(n())*c.extent[0];a=r*Math.cos(t)*i,f=e*i,p=r*Math.sin(t)*i}}else if(c.shape===`disc`){if(t===2)a=(n()*2-1)*c.extent[0];else{let e=n()*Math.PI*2,t=Math.sqrt(n())*c.extent[0];a=Math.cos(e)*t,p=Math.sin(e)*t}}if(i[r]=c.center[0]+a,i[r+1]=c.center[1]+f,i[r+2]=t===2?0:c.center[2]+p,i[r+3]=c.scalar,o){let e=c.speed*(1+(n()*2-1)*c.speedJitter),i,a,s=0;if(t===2){let t=(n()*2-1)*c.spread,r=Math.cos(t),o=Math.sin(t);i=(r*l-o*u)*e,a=(o*l+r*u)*e,n()}else{let t=1+n()*(Math.cos(c.spread)-1),r=Math.sqrt(Math.max(1-t*t,0)),o=n()*Math.PI*2,f=+(Math.abs(u)>.99),p=+!f,m=u*0-d*p,h=d*f-l*0,g=l*p-u*f,_=Math.hypot(m,h,g)||1;m/=_,h/=_,g/=_;let v=u*g-d*h,y=d*m-l*g,b=l*h-u*m,x=Math.cos(o)*r,S=Math.sin(o)*r;i=(l*t+m*x+v*S)*e,a=(u*t+h*x+y*S)*e,s=(d*t+g*x+b*S)*e}o[r]=i,o[r+1]=a,o[r+2]=s,o[r+3]=c.lifetime[0]+n()*(c.lifetime[1]-c.lifetime[0])}}}var c=`// The two per-particle kernels of the counting sort that builds the neighbour grid (the prefix sum between
// them is scan.wgsl, the reorder after them is ParticleSystem.permute). See neighbor-grid.ts for the whole
// algorithm and its costs.
//
// Every kernel binds its per-particle arrays with exactly \`count\` elements, so arrayLength is the live
// particle count; nothing here needs a count uniform.

#include "neighbors.wgsl"

@group(0) @binding(0) var<uniform> grid: NeighborGrid;
@group(0) @binding(1) var<storage, read> positions: array<vec4f>;
// cells + 1 counters. Cleared before this kernel; scan.wgsl turns them into start offsets afterwards.
@group(0) @binding(2) var<storage, read_write> counts: array<atomic<u32>>;
// Per particle: x the cell, y its rank among the particles of that cell (the counter's value before the add).
@group(0) @binding(3) var<storage, read_write> cell_rank: array<vec2u>;

// Stage 1 and 2 fused: find the particle's cell and take a ticket in it. The ticket (the old counter value) is
// the particle's rank within its cell, which fixes its final slot once the starts are known and removes the
// need for a second atomic pass with a per-cell cursor.
@compute @workgroup_size(64)
fn cells(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&positions)) { return; }
  let cell = neighbor_cell_id(grid, positions[i].xyz);
  let rank = atomicAdd(&counts[cell], 1u);
  cell_rank[i] = vec2u(cell, rank);
}
`,l=`// Stage 4 of the counting sort: with every cell's start offset known, particle i goes to slot
// start[cell] + rank. The result \`sorted\` is a permutation: sorted[k] is the particle that belongs in slot k.

@group(0) @binding(0) var<storage, read> cell_start: array<u32>;
@group(0) @binding(1) var<storage, read> cell_rank: array<vec2u>;
@group(0) @binding(2) var<storage, read_write> sorted: array<u32>;

@compute @workgroup_size(64)
fn scatter(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= arrayLength(&cell_rank)) { return; }
  let cr = cell_rank[i];
  sorted[cell_start[cr.x] + cr.y] = i;
}
`,u=`// Exclusive prefix sum over u32, in place, built from two kernels (see scan.ts for the levels).
//
// A workgroup of 256 invocations owns a tile of 1024 elements, four consecutive elements per invocation.
// scan_blocks scans each tile and writes the tile's total into \`sums\`; add_offsets later adds the
// (already scanned) tile offset back to every element of the tile. Both bind the data and sums arrays
// with exactly the length being scanned, so arrayLength is the element count.

@group(0) @binding(0) var<storage, read_write> data: array<u32>;
@group(0) @binding(1) var<storage, read_write> sums: array<u32>;

// One partial sum per invocation: 256 x 4 bytes = 1 KiB of the 16 KiB workgroup memory every device has.
var<workgroup> partial: array<u32, 256>;

@compute @workgroup_size(256)
fn scan_blocks(@builtin(local_invocation_id) lid: vec3u, @builtin(workgroup_id) wid: vec3u) {
  let n = arrayLength(&data);
  let base = wid.x * 1024u + lid.x * 4u;
  var v = vec4u(0u);
  if (base < n) { v.x = data[base]; }
  if (base + 1u < n) { v.y = data[base + 1u]; }
  if (base + 2u < n) { v.z = data[base + 2u]; }
  if (base + 3u < n) { v.w = data[base + 3u]; }

  // Exclusive prefixes inside this invocation's four elements.
  let e1 = v.x;
  let e2 = e1 + v.y;
  let e3 = e2 + v.z;
  let total = e3 + v.w;

  // Hillis-Steele inclusive scan of the 256 totals. Every step reads, waits, then writes, so no
  // invocation overwrites a value a neighbour has yet to read.
  partial[lid.x] = total;
  workgroupBarrier();
  for (var offset = 1u; offset < 256u; offset = offset << 1u) {
    var t = partial[lid.x];
    if (lid.x >= offset) {
      t += partial[lid.x - offset];
    }
    workgroupBarrier();
    partial[lid.x] = t;
    workgroupBarrier();
  }
  let inclusive = partial[lid.x];
  let prefix = inclusive - total;

  if (base < n) { data[base] = prefix; }
  if (base + 1u < n) { data[base + 1u] = prefix + e1; }
  if (base + 2u < n) { data[base + 2u] = prefix + e2; }
  if (base + 3u < n) { data[base + 3u] = prefix + e3; }
  if (lid.x == 255u) {
    sums[wid.x] = inclusive;
  }
}

@compute @workgroup_size(256)
fn add_offsets(@builtin(local_invocation_id) lid: vec3u, @builtin(workgroup_id) wid: vec3u) {
  let n = arrayLength(&data);
  let base = wid.x * 1024u + lid.x * 4u;
  let offset = sums[wid.x];
  if (base < n) { data[base] += offset; }
  if (base + 1u < n) { data[base + 1u] += offset; }
  if (base + 2u < n) { data[base + 2u] += offset; }
  if (base + 3u < n) { data[base + 3u] += offset; }
}
`,d=1024,f=d*65535;function p(e){let t=[e];for(;t[t.length-1]>d;)t.push(Math.ceil(t[t.length-1]/d));return t}function m(t){let{device:n,maxElements:i,profiler:a=e,label:o=`particles scan`}=t;if(!(i>=1)||i>67107840)throw RangeError(`scan length must be 1..${f}, got ${i}`);let s=r(n,{label:`particles/scan.wgsl`,code:u,entryPoint:`scan_blocks`,workgroupSize:256,profiler:a,timestamp:`${o}`}),c=r(n,{label:`particles/scan.wgsl`,code:u,entryPoint:`add_offsets`,workgroupSize:256,profiler:a,timestamp:`${o}`}),l=p(i).slice(1).map((e,t)=>n.createBuffer({label:`${o} tile sums ${t}`,size:e*4,usage:GPUBufferUsage.STORAGE})),m=n.createBuffer({label:`${o} sink`,size:16,usage:GPUBufferUsage.STORAGE});function h(e,t,n){if(!Number.isInteger(n)||n<0||n>i)throw RangeError(`scan count must be an integer 0..${i}, got ${n}`);if(n===0)return;if(t.size<n*4)throw RangeError(`${o}: buffer holds fewer than ${n} u32`);let r=p(n),a=[t,...l],u=e=>({buffer:a[e],size:r[e]*4}),f=e=>e+1<r.length?u(e+1):{buffer:m,size:16};for(let t=0;t<r.length;t++)s.runGroups(e,[u(t),f(t)],Math.ceil(r[t]/d));for(let t=r.length-2;t>=0;t--)c.runGroups(e,[u(t),f(t)],Math.ceil(r[t]/d))}return{maxElements:i,run:h,destroy(){for(let e of l)e.destroy();m.destroy(),s.destroy(),c.destroy()}}}var h=t(`NeighborGrid`,{origin:`vec3f`,cell_size:`f32`,dims:`vec3i`,rows:`u32`,radius:`f32`,inv_cell_size:`f32`,cells:`u32`,dimension:`u32`}),g=`neighbor_bindings.wgsl`,_=1+2**-12,v=1<<22;function y(e,t,n){let{min:r,max:i,radius:a}=e;if(!(a>0)||!Number.isFinite(a))throw RangeError(`neighbour radius must be positive and finite, got ${a}`);let o=[0,1,2].map(e=>Math.max(i[e]-r[e],0));if(o.some(e=>!Number.isFinite(e)))throw RangeError(`domain must be finite`);let s=Math.max(e.cellSize??a,a)*_,c=e=>[Math.max(1,Math.ceil(o[0]/e)),Math.max(1,Math.ceil(o[1]/e)),t===2?1:Math.max(1,Math.ceil(o[2]/e))],l=c(s),u=!1;for(;l[0]*l[1]*l[2]>n;){let e=l[0]*l[1]*l[2]/n;s*=Math.max(1.001,e**(1/t)*1.0001),l=c(s),u=!0}return{origin:[r[0],r[1],t===2?0:r[2]],cellSize:s,dims:l,cells:l[0]*l[1]*l[2],radius:a,coarsened:u}}var b=e=>`permute`in e;function x(t){let{device:i,dimension:a=3,profiler:o=e,label:s=`neighbor grid`}=t,u=t.mode??`reorder`,d=i.limits.maxStorageBufferBindingSize,p=Math.max(1,Math.min(t.maxCells??v,Math.floor(d/4)-1,f-1)),_=m({device:i,maxElements:p+1,profiler:o,label:`${s} scan`}),x=r(i,{label:`particles/neighbor-grid.wgsl`,code:c,entryPoint:`cells`,profiler:o,timestamp:`${s} cells`}),S=r(i,{label:`particles/neighbor-scatter.wgsl`,code:l,entryPoint:`scatter`,profiler:o,timestamp:`${s} scatter`}),C=n(i,h,`${s} uniform`),w,T=``,E=0,D=0,O=0,k,A,j,M=!1,N=(e,t,n=0)=>i.createBuffer({label:`${s} ${e}`,size:Math.max(16,t),usage:GPUBufferUsage.STORAGE|GPUBufferUsage.COPY_DST|GPUBufferUsage.COPY_SRC|n});function P(e){k&&e+1<=O||(k?.destroy(),O=Math.min(p+1,Math.max(e+1,Math.ceil(O*1.5))),k=N(`cell start`,O*4),E++)}function F(e){A&&e<=D||(A?.destroy(),j?.destroy(),D=Math.max(e,Math.ceil(D*1.5),t.capacity??65536),A=N(`cell and rank`,D*8),j=N(`sorted index`,D*4),E++)}F(1),P(1);let I={dimension:a,get mode(){return u},set mode(e){u=e},get generation(){return E},get layout(){if(!w)throw Error(`${s}: configure() has not been called`);return w},buffers:{get uniform(){return C.buffer},get cellStart(){return k},get sorted(){return j}},get storageBuffers(){return u===`sorted`?2:1},get memoryBytes(){return(k?.size??0)+(A?.size??0)+(j?.size??0)},configure(e){let t=y(e,a,p),n=`${t.origin}|${t.cellSize}|${t.dims}|${t.radius}`;return(!w||n!==T)&&(w=t,T=n,P(t.cells),C.set({origin:[...t.origin],cell_size:t.cellSize,dims:[...t.dims],rows:a===2?3:9,radius:t.radius,inv_cell_size:1/t.cellSize,cells:t.cells,dimension:a}),C.upload()),w},build(e,t,n={}){let r=I.layout,i=n.stopAfter??`reorder`,a,o;if(b(t)){if(a=t.attribute(n.attribute??`position`),t.components(n.attribute??`position`)!==4)throw TypeError(`${s}: the binned attribute must be a vec4 array`);o=t.count}else{if(u===`reorder`)throw TypeError(`${s}: reorder mode needs a ParticleSystem (to move every attribute); use mode 'sorted' for a bare buffer`);a=t.positions,o=t.count}if(o=Math.min(o,n.count??o),o<=0)return;F(o);let c=r.cells+1;e.clearBuffer(k,0,c*4),x.runCount(e,[C.buffer,{buffer:a,size:o*16},{buffer:k,size:c*4},{buffer:A,size:o*8}],o),i!==`cells`&&(_.run(e,k,c),i!==`scan`&&(S.runCount(e,[{buffer:k,size:c*4},{buffer:A,size:o*8},{buffer:j,size:o*4}],o),i!==`scatter`&&u===`reorder`&&b(t)&&t.permute(e,j,o)))},bindingsWgsl({group:e=0,binding:t}){let n=u===`sorted`;return`// Generated by NeighborGrid.bindingsWgsl: the grid's bindings and the two functions that hide them.
#include "neighbors.wgsl"
@group(${e}) @binding(${t}) var<uniform> neighbor_grid: NeighborGrid;
@group(${e}) @binding(${t+1}) var<storage, read> neighbor_cell_start: array<u32>;
${n?`@group(${e}) @binding(${t+2}) var<storage, read> neighbor_sorted: array<u32>;`:``}

fn neighbor_row_span(c: vec3i, row: u32) -> vec2u {
  let r = neighbor_row_cells(neighbor_grid, c, row);
  if (r.x < 0) {
    return vec2u(0u, 0u);
  }
  return vec2u(neighbor_cell_start[u32(r.x)], neighbor_cell_start[u32(r.y) + 1u]);
}

fn neighbor_particle(k: u32) -> u32 {
  return ${n?`neighbor_sorted[k]`:`k`};
}
`},chunks(e){return{[g]:I.bindingsWgsl(e)}},resources(){let e=[C.buffer,k];return u===`sorted`&&e.push(j),e},destroy(){M||(M=!0,_.destroy(),x.destroy(),S.destroy(),C.destroy(),k?.destroy(),A?.destroy(),j?.destroy())}};return I}var S=GPUBufferUsage.STORAGE|GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_SRC|GPUBufferUsage.COPY_DST,C=3,w={1:`f32`,2:`vec2f`,4:`vec4f`};function T(e){let t=e.map((e,t)=>{let n=w[e];return`@group(0) @binding(${1+t*2}) var<storage, read> src${t}: array<${n}>;\n@group(0) @binding(${2+t*2}) var<storage, read_write> dst${t}: array<${n}>;`}).join(`
`),n=e.map((e,t)=>`  dst${t}[k] = src${t}[j];`).join(`
`);return`// Generated by system.ts: slot k takes what slot sorted[k] held, for ${e.length} attribute(s).
@group(0) @binding(0) var<storage, read> sorted: array<u32>;
${t}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let k = id.x;
  if (k >= arrayLength(&sorted)) { return; }
  let j = sorted[k];
${n}
}
`}function E(t){let{device:n,dimension:i=3,velocities:a=!0,profiler:c=e,label:l=`particles`}=t,u=Math.floor(t.capacity);if(!(u>=1))throw RangeError(`capacity must be at least 1, got ${t.capacity}`);d(u);function d(e){let t=e*16;if(t>n.limits.maxStorageBufferBindingSize||t>n.limits.maxBufferSize)throw RangeError(`${l}: ${e} particles need ${t} bytes per attribute, over the device limit of ${Math.min(n.limits.maxStorageBufferBindingSize,n.limits.maxBufferSize)}`)}let f=[],p=new Map,m=(e,t)=>{let n={name:e,components:t,front:void 0,back:void 0};f.push(n),p.set(e,n)};m(`position`,4),a&&m(`velocity`,4);for(let[e,n]of Object.entries(t.extras??{})){if(p.has(e))throw TypeError(`${l}: duplicate attribute "${e}"`);if(![1,2,4].includes(n))throw TypeError(`${l}: attribute "${e}" must have 1, 2 or 4 components`);m(e,n)}let h=(e,t=``)=>n.createBuffer({label:`${l} ${e.name}${t}`,size:u*e.components*4,usage:S});for(let e of f)e.front=h(e);let g=0,_=0,v=t.radius,y=0,b=0,x=!1,w=new Uint8Array,E=new Float32Array,D=new Float32Array,O=e=>{let t=p.get(e);if(!t)throw TypeError(`${l}: no attribute "${e}"`);return t},k={get positions(){return f[0].front},get velocities(){return a?p.get(`velocity`).front:void 0},get count(){return g},get capacity(){return u},get radius(){return v},get generation(){return _}};function A(e,t){if(!(t<=e))for(let r of f){let i=r.components*4,a=(t-e)*i;w.length<a&&(w=new Uint8Array(a)),n.queue.writeBuffer(r.front,e*i,w,0,a)}}function j(e){e=Math.max(0,Math.min(u,Math.floor(e))),A(g,e),g=e,y=g%u}function M(e,t,r){let i=O(e);n.queue.writeBuffer(i.front,t*i.components*4,r)}let N=new Map;function P(e){let t=e.join(`,`),i=N.get(t);return i||(i=r(n,{label:`particles/gather-${t.replaceAll(`,`,``)}.wgsl`,code:T(e),profiler:c,timestamp:`${l} reorder`}),N.set(t,i)),i}let F={device:n,dimension:i,particles:k,get capacity(){return u},get count(){return g},get radius(){return v},set radius(e){v=e},get generation(){return _},get positions(){return f[0].front},get velocities(){return a?p.get(`velocity`).front:void 0},get attributeNames(){return f.map(e=>e.name)},attribute:e=>O(e).front,components:e=>O(e).components,back(e){let t=O(e);return t.back??=h(t,` (back)`),t.back},swap(e){let t=O(e);t.back??=h(t,` (back)`),[t.front,t.back]=[t.back,t.front]},fill(e,t){e=Math.max(0,Math.min(u,Math.floor(e)));let n=new Float32Array(e*4),r=a?new Float32Array(e*4):void 0,o={position:[0,0,0],scalar:0,velocity:[0,0,0],velocityW:0};for(let i=0;i<e;i++)o.position[0]=o.position[1]=o.position[2]=0,o.velocity[0]=o.velocity[1]=o.velocity[2]=0,o.scalar=0,o.velocityW=0,t(i,o),n.set(o.position,i*4),n[i*4+3]=o.scalar,r&&(r.set(o.velocity,i*4),r[i*4+3]=o.velocityW);if(i===2)for(let t=0;t<e;t++)n[t*4+2]=0;F.set({positions:n,velocities:r})},set({positions:e,velocities:t,extras:n}){if(e.length%4!=0)throw RangeError(`positions must be vec4 rows (length % 4)`);let r=Math.min(u,e.length/4);M(`position`,0,e.subarray(0,r*4)),a&&(t?M(`velocity`,0,t.subarray(0,r*4)):M(`velocity`,0,new Float32Array(r*4)));for(let e of f.slice(a?2:1)){let t=n?.[e.name];M(e.name,0,t?t.subarray(0,r*e.components):new Float32Array(r*e.components))}g=r,y=g%u},emit(e,t,r={}){t=Math.floor(t);let{ring:c=!1}=r;if(t=c?Math.min(t,u):Math.min(t,u-g),t<=0)return 0;let l=r.random??o(20973+b++);E.length<t*4&&(E=new Float32Array(t*4)),D.length<t*4&&(D=new Float32Array(t*4));let d=E,p=a?D:void 0;s(e,i,l,t,d,p);let m=c?y:g,h=Math.min(t,u-m);M(`position`,m,d.subarray(0,h*4)),p&&M(`velocity`,m,p.subarray(0,h*4)),h<t&&(M(`position`,0,d.subarray(h*4,t*4)),p&&M(`velocity`,0,p.subarray(h*4,t*4)));for(let e of f.slice(a?2:1)){let r=t*e.components*4;w.length<r&&(w=new Uint8Array(r));let i=h*e.components*4;n.queue.writeBuffer(e.front,m*e.components*4,w,0,i),h<t&&n.queue.writeBuffer(e.front,0,w,0,r-i)}return g=Math.min(u,g+t),y=(m+t)%u,t},setCount:j,resize(e){if(e=Math.floor(e),!(e>=1))throw RangeError(`capacity must be at least 1, got ${e}`);if(e===u)return;d(e);let t=Math.min(g,e),r=f.map(e=>({front:e.front,back:e.back}));u=e;let i=n.createCommandEncoder({label:`${l} resize`});f.forEach((e,n)=>{e.front=h(e),e.back=void 0,t>0&&i.copyBufferToBuffer(r[n].front,0,e.front,0,t*e.components*4)}),n.queue.submit([i.finish()]);for(let e of r)e.front.destroy(),e.back?.destroy();g=t,y=g%u,_++},permute(e,t,n=g){if(n=Math.min(n,g),!(n<=0)){for(let r=0;r<f.length;r+=C){let i=f.slice(r,r+C),a=P(i.map(e=>e.components)),o=[{buffer:t,size:n*4}];for(let e of i)e.back??=h(e,` (back)`),o.push({buffer:e.front},{buffer:e.back});a.runCount(e,o,n)}for(let e of f)[e.front,e.back]=[e.back,e.front]}},async read(e=`position`,t=g){let r=O(e);t=Math.min(t,u);let i=t*r.components*4,a=n.createBuffer({label:`${l} readback`,size:Math.max(4,i),usage:GPUBufferUsage.MAP_READ|GPUBufferUsage.COPY_DST}),o=n.createCommandEncoder();i>0&&o.copyBufferToBuffer(r.front,0,a,0,i),n.queue.submit([o.finish()]),await a.mapAsync(GPUMapMode.READ);let s=new Float32Array(a.getMappedRange().slice(0,i));return a.unmap(),a.destroy(),s},destroy(){if(!x){x=!0;for(let e of f)e.front.destroy(),e.back?.destroy();for(let e of N.values())e.destroy()}}};return F}export{a,o as i,x as n,i as r,E as t};