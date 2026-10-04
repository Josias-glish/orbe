#version 300 es
// Un triángulo que cubre toda la pantalla; el trabajo está en el fragment shader.
void main() {
  vec2 posiciones[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
  gl_Position = vec4(posiciones[gl_VertexID], 0.0, 1.0);
}
