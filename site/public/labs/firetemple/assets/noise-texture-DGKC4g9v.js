import{g as e,l as t,m as n}from"./post-B63xyOYX.js";import{t as r}from"./fullscreen-BDXEFvdz.js";import{t as i}from"./math-fT5w54uK.js";import{t as a}from"./fbm-C42g5uzM.js";import{t as o}from"./noise-BHiu8YkL.js";import{t as s}from"./hash-bWx0F85T.js";import{n as c,t as l}from"./mipmap-Db3J2-rP.js";var u={label:`emission/noise-bake.wgsl`,code:`// Bakes the shared noise texture (src/gpu/emission/noise-texture.ts): four tileable noise fields
// in one target. Each channel is 0..1 with a mean of 0.5; see noisetex.wgsl for how to read them.
#include "fullscreen.wgsl"
#include "fbm.wgsl"

// Cells of the coarsest octave across the tile. Must match NOISETEX_CELLS in noisetex.wgsl.
const BAKE_CELLS: i32 = 8;

@fragment fn fs(in: FullscreenVarying) -> @location(0) vec4f {
  let p = in.uv * f32(BAKE_CELLS);
  let period = vec2i(BAKE_CELLS);
  // Any real offset keeps a tile function periodic, so offsets give independent fields.
  let a = fbm_2d_tile(p, period, 4, 0.5);
  let b = fbm_2d_tile(p + vec2f(37.3, 11.7), period, 4, 0.5);
  let fine = fbm_2d_tile(p * 2.0 + vec2f(5.1, 71.9), period * 2, 3, 0.55);
  let grain = 0.5 + 0.5 * vnoise_2d_tile(in.uv * 64.0 + vec2f(13.7, 3.1), vec2i(64));
  // The fractal sums are within about +-0.75 in practice; spread them over the unit range.
  return vec4f(
    clamp(0.5 + 0.65 * a, 0.0, 1.0),
    clamp(0.5 + 0.65 * b, 0.0, 1.0),
    clamp(0.5 + 0.65 * fine, 0.0, 1.0),
    grain,
  );
}
`,chunks:{"fullscreen.wgsl":r,"fbm.wgsl":a,"noise.wgsl":o,"hash.wgsl":s,"math.wgsl":i}},d=`rgba16float`;function f(t){let r=t.createTexture({label:`shared noise`,size:[256,256],format:d,mipLevelCount:c(256,256),usage:GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.COPY_SRC}),i=n(t,{fragment:u,format:d}),a=t.createCommandEncoder({label:`bake shared noise`});return e(a,r.createView({baseMipLevel:0,mipLevelCount:1}),i),l(t,r,a),t.queue.submit([a.finish()]),{texture:r,view:r.createView({label:`shared noise view`}),sampler:t.createSampler({label:`shared noise sampler`,addressModeU:`repeat`,addressModeV:`repeat`,magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`}),size:256}}var p=t(f);export{p as t};