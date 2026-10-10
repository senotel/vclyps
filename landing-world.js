/* vClyps — the film world. Native WebGL, no external runtime.
   A solid, perforated film ribbon with real perspective, normals, thickness,
   depth testing and studio lighting. The same geometry unspools into a timeline.
   Only the landing owns this renderer; no editor media or state is consulted. */
(function (global) {
  "use strict";
  var VERTEX = `
    precision PREC float;
    attribute vec4 aGrid;
    attribute float aBand;
    uniform mat4 uProjection;
    uniform float uTime, uScroll, uAspect, uMobile, uPulse;
    uniform vec3 uPointer;
    varying vec2 vUv;
    varying vec3 vNormal, vPosition;
    varying float vBand, vFace;
    mat3 ry(float a) { float c=cos(a),s=sin(a); return mat3(c,0.,-s,0.,1.,0.,s,0.,c); }
    mat3 rx(float a) { float c=cos(a),s=sin(a); return mat3(1.,0.,0.,0.,c,s,0.,-s,c); }
    mat3 rz(float a) { float c=cos(a),s=sin(a); return mat3(c,s,0.,-s,c,0.,0.,0.,1.); }
    vec3 curve(float t, float band) {
      float a=t*5.55-.38;
      float breathe=sin(uTime*.33)*.045;
      vec3 loop=vec3(sin(a)*(1.75+.22*cos(a*2.)),cos(a)*2.28,sin(a*2.)*.95);
      loop.x += sin(a*3.+uTime*.27)*.055;
      loop.y += breathe;
      /* Clearly BEHIND, not interleaved — see the note in mesh(). */
      if (band>.5) { loop=ry(1.15)*loop*.62; loop.z-=2.35; loop.y+=.35; }
      float unfold=smoothstep(.08,1.3,uScroll);
      vec3 line=vec3((t-.5)*13.,sin(t*6.28+uTime*.25)*.18+(band-.5)*1.35,-1.4+cos(t*3.14)*.4);
      return mix(loop,line,unfold);
    }
    void main() {
      float t=aGrid.x, side=aGrid.y, depth=aGrid.z, face=aGrid.w;
      vec3 p,n;
      if (aBand<2.) {
        vec3 tangent=normalize(curve(t+.001,aBand)-curve(t-.001,aBand));
        float twist=t*6.28*.53+.4+sin(uTime*.2)*.07;
        vec3 across=vec3(cos(twist),0.,sin(twist));
        across=normalize(across-tangent*dot(across,tangent));
        vec3 normal=normalize(cross(tangent,across));
        float width=aBand<.5?.62:.39;
        p=curve(t,aBand)+across*side*width+normal*depth*.032;
        n=face<.5?normal:face<1.5?-normal:face<2.5?-across:across;
        mat3 rotate=rz(-.27+uScroll*.16)*ry(-.36+sin(uTime*.12)*.12+uScroll*.45)*rx(.1+uScroll*.12);
        p=rotate*p; n=rotate*n;
        float mobileScale=mix(1.,.77,uMobile);
        p*=mobileScale;
        p.x+=mix(2.65,0.,uMobile)*(1.-smoothstep(0.,1.25,uScroll));
        p.y+=mix(.12,-1.75,uMobile)+uScroll*.48;
      } else {
        float row=aBand-2.;
        p=vec3((t-.5)*31.,-3.2-row*.28+sin(t*10.+uTime*.25+row*.18)*.12,-3.5-row*.58);
        p.y+=side*.009; p.z+=depth*.009;
        n=vec3(0.,0.,1.);
      }
      // A spatial pressure field. The pointer is damped by a time-correct
      // spring on the CPU, so repulsion relaxes naturally when it leaves.
      vec2 delta=p.xy-uPointer.xy;
      float influence=exp(-dot(delta,delta)*.65)*uPointer.z;
      p.xy+=normalize(delta+vec2(.001))*influence*.32;
      p.z+=influence*.65+uPulse*exp(-abs(p.x)*.2)*.3;
      float camera=9.7-smoothstep(0.,1.3,uScroll)*.9;
      p.z-=camera;
      vPosition=p; vNormal=n; vUv=vec2(t,side*.5+.5); vBand=aBand; vFace=face;
      gl_Position=uProjection*vec4(p,1.);
    }
  `;
  var FRAGMENT = `
    precision PREC float;
    uniform sampler2D uImage;
    uniform float uTime, uScroll, uTextureReady;
    uniform vec3 uPointer;
    varying vec2 vUv;
    varying vec3 vNormal, vPosition;
    varying float vBand, vFace;
    void main() {
      vec3 n=normalize(vNormal);
      if(!gl_FrontFacing)n=-n;
      vec3 eye=normalize(-vPosition);
      vec3 key=normalize(vec3(-.6,1.,1.4));
      vec3 fill=normalize(vec3(1.,-.2,.3));
      float diff=max(dot(n,key),0.);
      float spec=pow(max(dot(n,normalize(key+eye)),0.),42.);
      float rim=pow(1.-max(dot(n,eye),0.),2.2);
      vec3 base=vec3(.42,.43,.38);
      float frame=fract(vUv.x*13.);
      float edge=abs(vUv.y-.5);
      bool front=vFace<1.5;
      // Actual alpha-cut sprocket holes, lit solid edges and image windows.
      if(front && edge>.403 && edge<.466 && fract(vUv.x*65.)>.25 && fract(vUv.x*65.)<.73) discard;
      if(vBand<2.) {
        if(front && edge<.36 && frame>.055 && frame<.945) {
          vec2 uv=vec2((frame-.055)/.89,(vUv.y-.14)/.72);
          vec3 picture=texture2D(uImage,vec2(uv.x,1.-uv.y)).rgb;
          float lum=dot(picture,vec3(.299,.587,.114));
          picture=mix(vec3(lum),picture,.65);
          base=mix(vec3(.1,.12,.11),picture,uTextureReady);
          if(vBand>.5)base=mix(base,vec3(.52,.065,.085),.65);
        } else {
          base=vBand<.5?vec3(.36,.38,.33):vec3(.48,.045,.067);
          if(edge>.485)base=vec3(.8,.79,.68);
        }
        vec3 color=base*(.43+diff*.66)+vec3(.93,.89,.75)*spec*.65;
        color+=vec3(.82,.84,.76)*rim*.24;
        color+=vec3(.39,.035,.055)*max(dot(n,fill),0.)*.4;
        float pressure=exp(-dot(vPosition.xy-uPointer.xy,vPosition.xy-uPointer.xy)*.5)*uPointer.z;
        color+=vec3(.14,.025,.028)*pressure;
        // Vary exposure between successive cells, as raw clips would vary.
        color*=.93+.07*sin(floor(vUv.x*13.)*2.4);
        gl_FragColor=vec4(color,1.);
      } else {
        float flow=.4+.6*pow(.5+.5*sin(vUv.x*30.-uTime*.8+vBand),8.);
        vec3 c=vBand<2.5?vec3(.6,.055,.085):vec3(.13,.15,.12);
        gl_FragColor=vec4(c*flow,1.);
      }
    }
  `;

  function create(canvas, onReady) {
    if (!canvas) return null;
    var gl;
    try { gl=canvas.getContext("webgl", {alpha:true,antialias:true,depth:true,powerPreference:"low-power"}); } catch (_) {}
    if (!gl) return null;
    var program, buffer, texture, uniforms, count=0;
    var raf=0, running=false, lost=false, disposed=false, last=0, time=0;
    var width=0,height=0,mobile=false,resizeNeeded=true;
    var state={visible:true,reduced:false,scroll:0};
    var target={x:0,y:0,strength:0}, point={x:0,y:0,strength:0}, velocity={x:0,y:0};
    var smoothScroll=0,pulse=0,slowFrames=0,quality=1,textureReady=0;
    var image=new Image();

    /* Both stages are compiled at the SAME precision — the highest this device
       supports in a fragment shader, since that is the stage with the weaker
       guarantee. Anything shared between the two then matches by construction. */
    var PREC = (function () {
      try {
        var f = gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER, gl.HIGH_FLOAT);
        return f && f.precision > 0 ? "highp" : "mediump";
      } catch (_) { return "mediump"; }
    })();
    function shader(type,source) {
      source = source.replace(/\bPREC\b/g, PREC);
      var s=gl.createShader(type); gl.shaderSource(s,source); gl.compileShader(s);
      if(!gl.getShaderParameter(s,gl.COMPILE_STATUS)) { var msg=gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(msg); }
      return s;
    }
    function mesh() {
      var a=[];
      function vertex(t,v,d,face,band) { a.push(t,v,d,face,band); }
      function quad(a0,b0,c0,d0,face,band) {
        [a0,b0,c0,a0,c0,d0].forEach(function(p){vertex(p[0],p[1],p[2],face,band);});
      }
      /* Segment counts are the difference between silk and facets. See the
         note in the shader: the trailing strips carry the pointer field, so
         they need the density most — they had the least. */
      var dense=!(window.matchMedia&&window.matchMedia("(pointer: coarse)").matches);
      for(var band=0;band<8;band++) {
        var segments=band<2?(dense?256:128):(dense?224:96);
        for(var j=0;j<segments;j++) {
          var u=j/segments,v=(j+1)/segments;
          quad([u,-1,1],[v,-1,1],[v,1,1],[u,1,1],0,band);
          quad([u,1,-1],[v,1,-1],[v,-1,-1],[u,-1,-1],1,band);
          quad([u,-1,-1],[v,-1,-1],[v,-1,1],[u,-1,1],2,band);
          quad([u,1,1],[v,1,1],[v,1,-1],[u,1,-1],3,band);
        }
      }
      count=a.length/5;
      return new Float32Array(a);
    }
    function uploadImage() {
      if(lost||disposed||!texture||!image.complete||!image.naturalWidth)return;
      try {
        // Rasterise only once. Keep the GPU texture below 1.4 MB on phones.
        var c=document.createElement("canvas"); c.width=512; c.height=640;
        var ctx=c.getContext("2d"); if(!ctx)return;
        ctx.drawImage(image,0,0,c.width,c.height);
        gl.bindTexture(gl.TEXTURE_2D,texture);
        gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,c);
        textureReady=1; request();
      } catch (_) { textureReady=0; }
    }
    function init() {
      var vs=shader(gl.VERTEX_SHADER,VERTEX),fs=shader(gl.FRAGMENT_SHADER,FRAGMENT);
      program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
      gl.deleteShader(vs);gl.deleteShader(fs);
      if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error("Landing shader link failed: " + (gl.getProgramInfoLog(program) || "no log"));
      gl.useProgram(program);
      buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,mesh(),gl.STATIC_DRAW);
      var grid=gl.getAttribLocation(program,"aGrid"),band=gl.getAttribLocation(program,"aBand");
      gl.enableVertexAttribArray(grid);gl.vertexAttribPointer(grid,4,gl.FLOAT,false,20,0);
      gl.enableVertexAttribArray(band);gl.vertexAttribPointer(band,1,gl.FLOAT,false,20,16);
      uniforms={}; ["uProjection","uTime","uScroll","uAspect","uMobile","uPulse","uPointer","uTextureReady","uImage"].forEach(function(n){uniforms[n]=gl.getUniformLocation(program,n);});
      texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([82,88,73,255]));
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.enable(gl.DEPTH_TEST);gl.depthFunc(gl.LEQUAL);gl.clearColor(0,0,0,0);
      gl.uniform1i(uniforms.uImage,0);textureReady=0;uploadImage();resizeNeeded=true;
    }
    function resize() {
      width=canvas.clientWidth||innerWidth;height=canvas.clientHeight||innerHeight;
      mobile=width<=700 || (width<=1000 && height>width);
      var dpr=Math.min(devicePixelRatio||1,mobile?1.25:1.5)*quality;
      dpr=Math.min(dpr,1600/width,1200/height);
      canvas.width=Math.max(1,Math.round(width*dpr));canvas.height=Math.max(1,Math.round(height*dpr));
      gl.viewport(0,0,canvas.width,canvas.height);
      var f=1/Math.tan(43*Math.PI/360),aspect=width/height,near=.1,far=50;
      gl.uniformMatrix4fv(uniforms.uProjection,false,new Float32Array([f/aspect,0,0,0,0,f,0,0,0,0,(far+near)/(near-far),-1,0,0,2*far*near/(near-far),0]));
      gl.uniform1f(uniforms.uAspect,aspect);gl.uniform1f(uniforms.uMobile,mobile?1:0);resizeNeeded=false;
    }
    function frame(now) {
      raf=0;
      if(disposed||lost||!state.visible||document.hidden)return;
      if(resizeNeeded)resize();
      var elapsed=last?now-last:16.7;
      // Mobile gets a deliberate 30fps interpretation. Desktop is 60fps.
      if(mobile&&!state.reduced&&elapsed<31){raf=requestAnimationFrame(frame);return;}
      if(elapsed>36&&elapsed<150&&!mobile)slowFrames++;else slowFrames=Math.max(0,slowFrames-1);
      if(slowFrames>90&&quality> .65){quality=.65;resizeNeeded=true;slowFrames=0;}
      var dt=Math.min(.045,elapsed/1000);last=now;
      if(!state.reduced)time+=dt;
      var settle=1-Math.exp(-dt*8);
      smoothScroll+=((state.reduced?state.scroll:state.scroll)-smoothScroll)*settle;
      if(state.reduced)smoothScroll=state.scroll;
      // Critically damped spring, integrated with a bounded delta after sleep.
      ["x","y"].forEach(function(k){velocity[k]+=(target[k]-point[k])*90*dt;velocity[k]*=Math.exp(-dt*15);point[k]+=velocity[k]*dt;});
      point.strength+=(target.strength-point.strength)*settle;pulse*=Math.exp(-dt*5);
      gl.clear(gl.COLOR_BUFFER_BIT|gl.DEPTH_BUFFER_BIT);
      gl.uniform1f(uniforms.uTime,state.reduced?0:time);gl.uniform1f(uniforms.uScroll,smoothScroll);
      gl.uniform1f(uniforms.uPulse,state.reduced?0:pulse);gl.uniform1f(uniforms.uTextureReady,textureReady);
      gl.uniform3f(uniforms.uPointer,point.x,point.y,state.reduced?0:point.strength);
      gl.drawArrays(gl.TRIANGLES,0,count);
      if(!running){running=true;canvas.dataset.renderer="webgl";if(onReady)onReady(true);}
      if(!state.reduced)raf=requestAnimationFrame(frame);
    }
    function request(){if(!raf&&!disposed&&!lost&&state.visible&&!document.hidden)raf=requestAnimationFrame(frame);}
    function stop(){if(raf)cancelAnimationFrame(raf);raf=0;last=0;}
    function contextLost(event){event.preventDefault();lost=true;stop();running=false;canvas.dataset.renderer="fallback";if(onReady)onReady(false);}
    function contextRestored(){if(disposed)return;lost=false;try{init();request();}catch(_){contextLost({preventDefault:function(){}});}}
    canvas.addEventListener("webglcontextlost",contextLost);
    canvas.addEventListener("webglcontextrestored",contextRestored);
    try{init();}catch(error){canvas.dataset.renderer="fallback";canvas.dataset.rendererError=String(error.message||error);return null;}
    image.onload=uploadImage;image.src="landing-frame.svg";
    request();
    return {
      update:function(next){Object.assign(state,next);if(!state.visible)stop();else request();},
      resize:function(){resizeNeeded=true;request();},
      pointer:function(x,y,strength){var span=9.7*Math.tan(43*Math.PI/360);target.x=(x*2-1)*span*(width/Math.max(1,height));target.y=(1-y*2)*span;target.strength=strength;request();},
      pulse:function(){pulse=1;request();},
      dispose:function(){disposed=true;stop();canvas.removeEventListener("webglcontextlost",contextLost);canvas.removeEventListener("webglcontextrestored",contextRestored);image.onload=null;gl.deleteBuffer(buffer);gl.deleteTexture(texture);gl.deleteProgram(program);}
    };
  }
  global.VevrisLandingWorld={create:create};
})(window);
