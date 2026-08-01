import * as THREE from '/vendor/three.module.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { createGeometryKit } from '/client/img2threejs/runtime/geometry_kit.js';
const { addMesh, addPlate, addTrimmedPlate, addOutline, addCurvedTube, addRivet, addRivetRow, addTube, addTaperedTube, addRing, addSocket, rebasePivot, mergeStaticMeshesByMaterial, measureModelPerformance } = createGeometryKit(THREE, {
    mergeGeometries
});
const assetUrl = (name)=>new URL(`./${name}`, import.meta.url).href;
function configureTexture(texture, color = false, repeat = [
    2,
    2
]) {
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(repeat[0], repeat[1]);
    texture.anisotropy = 4;
    if (color) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
}
function loadMaterialMaps(loader, id, repeat = [
    2,
    2
]) {
    return {
        map: configureTexture(loader.load(assetUrl(`${id}_albedo.png`)), true, repeat),
        roughnessMap: configureTexture(loader.load(assetUrl(`${id}_roughness.png`)), false, repeat),
        normalMap: configureTexture(loader.load(assetUrl(`${id}_normal.png`)), false, repeat),
        bumpMap: configureTexture(loader.load(assetUrl(`${id}_height.png`)), false, repeat)
    };
}
function makeNoiseTexture(seed, base, spread, scale = 3) {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const image = context.createImageData(256, 256);
    let state = seed >>> 0;
    const random = ()=>{
        state = 1664525 * state + 1013904223 >>> 0;
        return state / 0xffffffff;
    };
    for(let i = 0; i < image.data.length; i += 4){
        const coarse = Math.sin(i / 4 % 256 / 19) * 0.28;
        const value = THREE.MathUtils.clamp(base + (random() - 0.5 + coarse) * spread, 0, 255);
        image.data[i] = value;
        image.data[i + 1] = value;
        image.data[i + 2] = value;
        image.data[i + 3] = 255;
    }
    context.putImageData(image, 0, 0);
    for(let i = 0; i < 22; i += 1){
        context.strokeStyle = `rgba(255,255,255,${0.05 + random() * 0.11})`;
        context.lineWidth = 0.35 + random();
        context.beginPath();
        const x = random() * 256;
        const y = random() * 256;
        context.moveTo(x, y);
        context.lineTo(x + 12 + random() * 42, y + (random() - 0.5) * 5);
        context.stroke();
    }
    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(scale, scale);
    texture.anisotropy = 4;
    return texture;
}
function applyReferenceProjection(material, projectionMap, strength) {
    material.onBeforeCompile = (shader)=>{
        shader.uniforms.shiomanekiProjection = {
            value: projectionMap
        };
        shader.uniforms.shiomanekiProjectionStrength = {
            value: strength
        };
        shader.vertexShader = `
      varying vec3 vShiomanekiWorld;
      varying float vShiomanekiFacing;
    ${shader.vertexShader}`.replace('#include <begin_vertex>', `#include <begin_vertex>
         vShiomanekiWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;
         vShiomanekiFacing = normalize(normalMatrix * normal).z;`);
        shader.fragmentShader = `
      uniform sampler2D shiomanekiProjection;
      uniform float shiomanekiProjectionStrength;
      varying vec3 vShiomanekiWorld;
      varying float vShiomanekiFacing;
    ${shader.fragmentShader}`.replace('#include <color_fragment>', `#include <color_fragment>
         vec2 shiomanekiUv = vec2(
           0.4975 + (vShiomanekiWorld.x / 3.72) * 0.711,
           0.091 + (vShiomanekiWorld.y / 4.24) * 0.845
         );
         vec4 shiomanekiPixel = texture2D(shiomanekiProjection, shiomanekiUv);
         float shiomanekiInside =
           step(0.0, shiomanekiUv.x) * step(shiomanekiUv.x, 1.0) *
           step(0.0, shiomanekiUv.y) * step(shiomanekiUv.y, 1.0);
         float shiomanekiFront = smoothstep(0.18, 0.82, vShiomanekiFacing);
         float shiomanekiMask = shiomanekiPixel.a * shiomanekiFront * shiomanekiInside * shiomanekiProjectionStrength;
         diffuseColor.rgb = mix(diffuseColor.rgb, shiomanekiPixel.rgb * 1.08, shiomanekiMask);`);
    };
    material.customProgramCacheKey = ()=>`shiomaneki-projection-${strength}`;
    material.needsUpdate = true;
    return material;
}
function makeMaterials() {
    const tealRoughness = makeNoiseTexture(1107, 142, 64, 3.4);
    const tealBump = makeNoiseTexture(7781, 116, 92, 4.8);
    const brassRoughness = makeNoiseTexture(8803, 112, 34, 4);
    const clothBump = makeNoiseTexture(991, 128, 46, 6);
    const projectionMap = new THREE.TextureLoader().load(assetUrl('reference-front.png'));
    projectionMap.colorSpace = THREE.SRGBColorSpace;
    projectionMap.wrapS = THREE.ClampToEdgeWrapping;
    projectionMap.wrapT = THREE.ClampToEdgeWrapping;
    projectionMap.anisotropy = 8;
    const materials = {
        teal: new THREE.MeshPhysicalMaterial({
            color: 0x2d6870,
            metalness: 0.62,
            roughness: 0.38,
            clearcoat: 0.25,
            clearcoatRoughness: 0.46,
            roughnessMap: tealRoughness,
            bumpMap: tealBump,
            bumpScale: 0.025
        }),
        tealDark: new THREE.MeshPhysicalMaterial({
            color: 0x285c65,
            metalness: 0.7,
            roughness: 0.34,
            clearcoat: 0.18
        }),
        tealEdge: new THREE.MeshPhysicalMaterial({
            color: 0x5a9294,
            metalness: 0.76,
            roughness: 0.27
        }),
        brass: new THREE.MeshPhysicalMaterial({
            color: 0x9a7650,
            metalness: 0.82,
            roughness: 0.35,
            roughnessMap: brassRoughness
        }),
        brassBright: new THREE.MeshPhysicalMaterial({
            color: 0xc3a16c,
            metalness: 0.86,
            roughness: 0.24
        }),
        darkMetal: new THREE.MeshPhysicalMaterial({
            color: 0x17222a,
            metalness: 0.8,
            roughness: 0.3
        }),
        cloth: new THREE.MeshStandardMaterial({
            color: 0x18294d,
            metalness: 0.03,
            roughness: 0.82,
            bumpMap: clothBump,
            bumpScale: 0.018
        }),
        clothLight: new THREE.MeshStandardMaterial({
            color: 0x293c68,
            roughness: 0.84
        }),
        rope: new THREE.MeshStandardMaterial({
            color: 0xb29a72,
            metalness: 0.02,
            roughness: 0.9,
            normalScale: new THREE.Vector2(0.3, 0.3),
            bumpScale: 0.015
        }),
        visor: new THREE.MeshPhysicalMaterial({
            color: 0x071318,
            metalness: 0.25,
            roughness: 0.13,
            clearcoat: 0.7,
            emissive: 0x08242b,
            emissiveIntensity: 0.45
        }),
        eye: new THREE.MeshPhysicalMaterial({
            color: 0xffb65d,
            emissive: 0xff6a18,
            emissiveIntensity: 3.2,
            roughness: 0.12
        }),
        tooth: new THREE.MeshStandardMaterial({
            color: 0xb9ab8f,
            roughness: 0.62,
            metalness: 0.08
        })
    };
    for (const id of [
        'teal',
        'tealDark',
        'tealEdge',
        'cloth',
        'clothLight'
    ]){
        applyReferenceProjection(materials[id], projectionMap, id.startsWith('cloth') ? 0.42 : 0.55);
    }
    applyReferenceProjection(materials.brass, projectionMap, 0.3);
    return materials;
}
function buildHead(root, m) {
    const head = new THREE.Group();
    head.name = 'pivot_head';
    root.add(head);
    addMesh(head, new THREE.SphereGeometry(0.38, 32, 22), m.darkMetal, 'head_core', [
        0,
        3.37,
        0
    ], [
        0,
        0,
        0
    ], [
        1.2,
        0.8,
        0.94
    ]);
    addMesh(head, new THREE.SphereGeometry(0.38, 32, 22), m.teal, 'helmet_curved_shell', [
        0,
        3.4,
        0.04
    ], [
        0,
        0,
        0
    ], [
        1.22,
        0.84,
        0.9
    ]);
    addRing(head, 'neck_guard_lower', [
        0,
        3.08,
        0
    ], 0.34, 0.055, m.brass);
    addRing(head, 'neck_guard_upper', [
        0,
        3.13,
        0
    ], 0.31, 0.045, m.tealEdge);
    const helmet = [
        [
            -0.29,
            0.09
        ],
        [
            -0.25,
            0.31
        ],
        [
            -0.13,
            0.48
        ],
        [
            0,
            0.53
        ],
        [
            0.13,
            0.48
        ],
        [
            0.25,
            0.31
        ],
        [
            0.29,
            0.09
        ],
        [
            0.23,
            -0.18
        ],
        [
            0.08,
            -0.3
        ],
        [
            -0.08,
            -0.3
        ],
        [
            -0.23,
            -0.18
        ]
    ];
    addTrimmedPlate(head, 'helmet_face_shell', helmet.map(([x, y])=>[
            x * 1.12,
            y
        ]), 0.2, m, [
        0,
        3.37,
        0.18
    ], [
        0,
        0,
        0
    ], 1.035);
    addPlate(head, 'helmet_center_ridge', [
        [
            -0.055,
            -0.25
        ],
        [
            -0.075,
            0.31
        ],
        [
            0,
            0.5
        ],
        [
            0.075,
            0.31
        ],
        [
            0.055,
            -0.25
        ]
    ], 0.08, m.tealEdge, [
        0,
        3.38,
        0.32
    ]);
    addPlate(head, 'helmet_left_brow', [
        [
            -0.27,
            0.04
        ],
        [
            -0.04,
            0.08
        ],
        [
            -0.06,
            -0.04
        ],
        [
            -0.25,
            -0.09
        ]
    ], 0.055, m.brass, [
        0,
        3.38,
        0.34
    ]);
    addPlate(head, 'helmet_right_brow', [
        [
            0.27,
            0.04
        ],
        [
            0.04,
            0.08
        ],
        [
            0.06,
            -0.04
        ],
        [
            0.25,
            -0.09
        ]
    ], 0.055, m.brass, [
        0,
        3.38,
        0.34
    ]);
    addMesh(head, new THREE.BoxGeometry(0.44, 0.095, 0.055), m.visor, 'visor_slit', [
        0,
        3.35,
        0.37
    ]);
    addRivet(head, 'eye_left', [
        -0.13,
        3.36,
        0.405
    ], m.eye, 0.035, [
        1.1,
        0.8,
        0.5
    ]);
    addRivet(head, 'eye_right', [
        0.13,
        3.36,
        0.405
    ], m.eye, 0.035, [
        1.1,
        0.8,
        0.5
    ]);
    addPlate(head, 'helmet_mandible', [
        [
            -0.24,
            0.02
        ],
        [
            -0.17,
            -0.18
        ],
        [
            -0.06,
            -0.27
        ],
        [
            0.06,
            -0.27
        ],
        [
            0.17,
            -0.18
        ],
        [
            0.24,
            0.02
        ],
        [
            0.13,
            -0.07
        ],
        [
            0,
            -0.12
        ],
        [
            -0.13,
            -0.07
        ]
    ], 0.08, m.darkMetal, [
        0,
        3.24,
        0.34
    ]);
    addPlate(head, 'helmet_left_cheek', [
        [
            -0.28,
            0.12
        ],
        [
            -0.39,
            0.02
        ],
        [
            -0.32,
            -0.2
        ],
        [
            -0.18,
            -0.25
        ],
        [
            -0.11,
            -0.08
        ]
    ], 0.09, m.teal, [
        0,
        3.26,
        0.31
    ]);
    addPlate(head, 'helmet_right_cheek', [
        [
            0.28,
            0.12
        ],
        [
            0.39,
            0.02
        ],
        [
            0.32,
            -0.2
        ],
        [
            0.18,
            -0.25
        ],
        [
            0.11,
            -0.08
        ]
    ], 0.09, m.teal, [
        0,
        3.26,
        0.31
    ]);
    addRivetRow(head, 'helmet_rivet', [
        [
            -0.21,
            3.58,
            0.36
        ],
        [
            0.21,
            3.58,
            0.36
        ],
        [
            -0.24,
            3.2,
            0.34
        ],
        [
            0.24,
            3.2,
            0.34
        ]
    ], m.brassBright, 0.026);
    addPlate(head, 'helmet_left_neck_flare', [
        [
            -0.08,
            0.16
        ],
        [
            -0.42,
            0.08
        ],
        [
            -0.46,
            -0.09
        ],
        [
            -0.18,
            -0.17
        ],
        [
            0,
            -0.05
        ]
    ], 0.12, m.teal, [
        0,
        3.08,
        0.12
    ]);
    addPlate(head, 'helmet_right_neck_flare', [
        [
            0.08,
            0.16
        ],
        [
            0.42,
            0.08
        ],
        [
            0.46,
            -0.09
        ],
        [
            0.18,
            -0.17
        ],
        [
            0,
            -0.05
        ]
    ], 0.12, m.teal, [
        0,
        3.08,
        0.12
    ]);
    addTube(head, 'antenna_left', [
        -0.08,
        3.8,
        0
    ], [
        -0.34,
        4.04,
        -0.01
    ], 0.018, m.brass, 8);
    addTube(head, 'antenna_left_tip', [
        -0.34,
        4.04,
        -0.01
    ], [
        -0.55,
        4.14,
        0
    ], 0.013, m.brassBright, 8);
    addTube(head, 'antenna_right', [
        0.08,
        3.8,
        0
    ], [
        0.34,
        4.04,
        -0.01
    ], 0.018, m.brass, 8);
    addTube(head, 'antenna_right_tip', [
        0.34,
        4.04,
        -0.01
    ], [
        0.55,
        4.14,
        0
    ], 0.013, m.brassBright, 8);
    addSocket(head, 'socket_head_vfx', [
        0,
        3.75,
        0.1
    ]);
    rebasePivot(head, [
        0,
        3.12,
        0
    ]);
    head.scale.set(0.92, 0.92, 0.96);
}
function buildTorso(root, m) {
    const torso = new THREE.Group();
    torso.name = 'pivot_torso';
    root.add(torso);
    addMesh(torso, new THREE.CapsuleGeometry(0.53, 0.58, 12, 24), m.cloth, 'torso_underlayer', [
        0,
        2.52,
        -0.04
    ], [
        0,
        0,
        0
    ], [
        1.2,
        1.08,
        0.82
    ]);
    addTaperedTube(torso, 'left_side_body_continuity', [
        -0.53,
        2.83,
        -0.04
    ], [
        -0.47,
        1.7,
        -0.02
    ], 0.4, 0.35, m.cloth, 20);
    addTaperedTube(torso, 'right_side_body_continuity', [
        0.53,
        2.83,
        -0.04
    ], [
        0.47,
        1.7,
        -0.02
    ], 0.4, 0.35, m.cloth, 20);
    addMesh(torso, new THREE.SphereGeometry(0.5, 40, 26), m.teal, 'chest_curved_shell', [
        0,
        2.84,
        0.08
    ], [
        0,
        0,
        0
    ], [
        1.38,
        1.04,
        0.9
    ]);
    addMesh(torso, new THREE.SphereGeometry(0.4, 32, 20), m.cloth, 'abdomen_continuity', [
        0,
        2.12,
        -0.02
    ], [
        0,
        0,
        0
    ], [
        1.12,
        1.12,
        0.78
    ]);
    const chest = [
        [
            -0.67,
            0.28
        ],
        [
            -0.57,
            0.54
        ],
        [
            -0.29,
            0.69
        ],
        [
            0,
            0.73
        ],
        [
            0.29,
            0.69
        ],
        [
            0.57,
            0.54
        ],
        [
            0.67,
            0.28
        ],
        [
            0.58,
            -0.24
        ],
        [
            0.32,
            -0.43
        ],
        [
            0,
            -0.5
        ],
        [
            -0.32,
            -0.43
        ],
        [
            -0.58,
            -0.24
        ]
    ].map(([x, y])=>[
            x,
            y * 0.8
        ]);
    addOutline(torso, 'chest_shell_edge', chest.map(([x, y])=>[
            x,
            y + 2.78
        ]), 0.5, 0.025, m.brass);
    addPlate(torso, 'chest_lower_lamella', chest.map(([x, y])=>[
            x * 0.82,
            y * 0.38 - 0.18
        ]), 0.08, m.tealDark, [
        0,
        2.56,
        0.49
    ]);
    addPlate(torso, 'chest_upper_inset', [
        [
            -0.47,
            0.1
        ],
        [
            -0.34,
            0.38
        ],
        [
            0,
            0.5
        ],
        [
            0.34,
            0.38
        ],
        [
            0.47,
            0.1
        ],
        [
            0.32,
            -0.02
        ],
        [
            0,
            0.05
        ],
        [
            -0.32,
            -0.02
        ]
    ], 0.055, m.tealDark, [
        0,
        2.83,
        0.43
    ]);
    addTube(torso, 'chest_harness_left', [
        -0.5,
        3.09,
        0.48
    ], [
        -0.16,
        2.78,
        0.53
    ], 0.026, m.brass, 8);
    addTube(torso, 'chest_harness_right', [
        0.5,
        3.09,
        0.48
    ], [
        0.16,
        2.78,
        0.53
    ], 0.026, m.brass, 8);
    addRing(torso, 'chest_medallion_outer', [
        0,
        2.87,
        0.5
    ], 0.13, 0.03, m.brass);
    addMesh(torso, new THREE.CylinderGeometry(0.095, 0.095, 0.035, 24), m.brassBright, 'chest_medallion', [
        0,
        2.87,
        0.51
    ], [
        Math.PI / 2,
        0,
        0
    ]);
    addPlate(torso, 'chest_medallion_mark', [
        [
            0,
            0.07
        ],
        [
            0.02,
            0.02
        ],
        [
            0.07,
            0
        ],
        [
            0.02,
            -0.02
        ],
        [
            0,
            -0.07
        ],
        [
            -0.02,
            -0.02
        ],
        [
            -0.07,
            0
        ],
        [
            -0.02,
            0.02
        ]
    ], 0.02, m.darkMetal, [
        0,
        2.87,
        0.55
    ]);
    addRivetRow(torso, 'chest_rivet', [
        [
            -0.49,
            2.98,
            0.47
        ],
        [
            0.49,
            2.98,
            0.47
        ],
        [
            -0.55,
            2.61,
            0.45
        ],
        [
            0.55,
            2.61,
            0.45
        ],
        [
            -0.3,
            2.3,
            0.43
        ],
        [
            0.3,
            2.3,
            0.43
        ]
    ], m.brassBright, 0.034);
    addRivetRow(torso, 'chest_micro_rivet', [
        [
            -0.33,
            3.15,
            0.47
        ],
        [
            0.33,
            3.15,
            0.47
        ],
        [
            -0.4,
            2.79,
            0.5
        ],
        [
            0.4,
            2.79,
            0.5
        ]
    ], m.brassBright, 0.022);
    addRing(torso, 'abdomen_ring_outer', [
        0,
        2.15,
        0.05
    ], 0.42, 0.065, m.brass);
    addRing(torso, 'abdomen_ring_inner', [
        0,
        2.15,
        0.08
    ], 0.34, 0.045, m.tealEdge);
    addPlate(torso, 'abdomen_guard', [
        [
            -0.38,
            0.14
        ],
        [
            0,
            0.27
        ],
        [
            0.38,
            0.14
        ],
        [
            0.31,
            -0.18
        ],
        [
            0,
            -0.27
        ],
        [
            -0.31,
            -0.18
        ]
    ], 0.17, m.teal, [
        0,
        2.12,
        0.24
    ]);
    addRivet(torso, 'abdomen_center_bolt', [
        0,
        2.12,
        0.36
    ], m.brassBright, 0.055);
    addSocket(torso, 'socket_chest_vfx', [
        0,
        2.85,
        0.58
    ]);
    rebasePivot(torso, [
        0,
        1.9,
        0
    ]);
}
function buildShoulder(root, m, side) {
    const sign = side === 'left' ? -1 : 1;
    const shoulder = new THREE.Group();
    shoulder.name = `pivot_${side}_shoulder`;
    root.add(shoulder);
    addMesh(shoulder, new THREE.SphereGeometry(0.34, 28, 20), m.cloth, `${side}_shoulder_cloth`, [
        sign * 0.82,
        3.08,
        -0.01
    ], [
        0,
        0,
        0
    ], [
        1.3,
        1.22,
        0.9
    ]);
    addMesh(shoulder, new THREE.SphereGeometry(0.36, 30, 22), m.teal, `${side}_shoulder_curved_shell`, [
        sign * 0.91,
        3.16,
        0.08
    ], [
        0,
        0,
        0
    ], [
        1.2,
        1.18,
        0.84
    ]);
    const points = (sign < 0 ? [
        [
            -0.09,
            0.48
        ],
        [
            -0.38,
            0.39
        ],
        [
            -0.54,
            0.12
        ],
        [
            -0.5,
            -0.26
        ],
        [
            -0.3,
            -0.46
        ],
        [
            0.02,
            -0.34
        ],
        [
            0.14,
            0.12
        ]
    ] : [
        [
            0.09,
            0.48
        ],
        [
            0.38,
            0.39
        ],
        [
            0.54,
            0.12
        ],
        [
            0.5,
            -0.26
        ],
        [
            0.3,
            -0.46
        ],
        [
            -0.02,
            -0.34
        ],
        [
            -0.14,
            0.12
        ]
    ]).map(([x, y])=>[
            x,
            y * 0.82
        ]);
    addTrimmedPlate(shoulder, `${side}_shoulder_shell`, points.map(([x, y])=>[
            x * 0.86,
            y * 0.72
        ]), 0.12, m, [
        sign * 0.91,
        3.14,
        0.3
    ], [
        0,
        sign * -0.08,
        sign * -0.08
    ], 1.025);
    addPlate(shoulder, `${side}_shoulder_lower_lamella`, points.map(([x, y])=>[
            x * 0.72,
            y * 0.52 - 0.07
        ]), 0.06, m.tealDark, [
        sign * 0.91,
        3.02,
        0.4
    ]);
    addRivetRow(shoulder, `${side}_shoulder_rivet`, [
        [
            sign * 0.62,
            3.18,
            0.38
        ],
        [
            sign * 0.86,
            3.28,
            0.36
        ],
        [
            sign * 1.05,
            3.08,
            0.34
        ],
        [
            sign * 1.05,
            2.82,
            0.32
        ]
    ], m.brassBright, 0.034);
    rebasePivot(shoulder, [
        sign * 0.72,
        2.9,
        0
    ]);
    shoulder.scale.set(0.86, 0.9, 0.92);
}
function buildClawArm(root, m) {
    const arm = new THREE.Group();
    arm.name = 'pivot_left_arm';
    root.add(arm);
    addTaperedTube(arm, 'left_upper_arm_cloth', [
        -0.82,
        2.78,
        0
    ], [
        -1.08,
        2.23,
        0.02
    ], 0.24, 0.22, m.cloth, 18);
    addRing(arm, 'left_elbow_ring', [
        -1.09,
        2.18,
        0
    ], 0.25, 0.045, m.brass, [
        Math.PI / 2,
        0,
        -0.22
    ]);
    addMesh(arm, new THREE.SphereGeometry(0.42, 28, 20), m.teal, 'claw_forearm_curved_shell', [
        -1.18,
        1.75,
        0.08
    ], [
        0,
        0,
        -0.12
    ], [
        1.04,
        1.56,
        0.86
    ]);
    const forearm = [
        [
            -0.32,
            0.53
        ],
        [
            -0.58,
            0.25
        ],
        [
            -0.52,
            -0.48
        ],
        [
            -0.24,
            -0.72
        ],
        [
            0.2,
            -0.62
        ],
        [
            0.33,
            -0.05
        ],
        [
            0.2,
            0.48
        ]
    ];
    addTrimmedPlate(arm, 'claw_forearm_shell', forearm.map(([x, y])=>[
            x * 0.9,
            y * 0.92
        ]), 0.2, m, [
        -1.17,
        1.76,
        0.39
    ], [
        0,
        0,
        -0.12
    ], 1.025);
    addRivetRow(arm, 'claw_forearm_rivet', [
        [
            -1.49,
            2.08,
            0.33
        ],
        [
            -1.39,
            1.77,
            0.35
        ],
        [
            -1.31,
            1.48,
            0.35
        ],
        [
            -1.02,
            2.08,
            0.35
        ],
        [
            -0.95,
            1.72,
            0.34
        ]
    ], m.brassBright, 0.045);
    const upperJaw = [
        [
            -0.02,
            0.58
        ],
        [
            -0.36,
            0.72
        ],
        [
            -0.73,
            0.61
        ],
        [
            -0.97,
            0.3
        ],
        [
            -1.02,
            -0.12
        ],
        [
            -0.89,
            -0.38
        ],
        [
            -0.65,
            -0.16
        ],
        [
            -0.55,
            0.13
        ],
        [
            -0.31,
            0.25
        ],
        [
            -0.08,
            0.14
        ],
        [
            0.08,
            0.28
        ]
    ].map(([x, y])=>[
            x * 0.76,
            y * 1.18
        ]);
    const lowerJaw = [
        [
            -0.01,
            -0.57
        ],
        [
            -0.35,
            -0.72
        ],
        [
            -0.72,
            -0.62
        ],
        [
            -0.96,
            -0.34
        ],
        [
            -1.03,
            0.06
        ],
        [
            -0.88,
            0.34
        ],
        [
            -0.65,
            0.15
        ],
        [
            -0.53,
            -0.12
        ],
        [
            -0.3,
            -0.25
        ],
        [
            -0.07,
            -0.13
        ],
        [
            0.1,
            -0.27
        ]
    ].map(([x, y])=>[
            x * 0.76,
            y * 1.18
        ]);
    addTrimmedPlate(arm, 'claw_upper_jaw', upperJaw, 0.36, m, [
        -1.16,
        1.0,
        0.12
    ], [
        0,
        0,
        0.03
    ], 1.025);
    addTrimmedPlate(arm, 'claw_lower_jaw', lowerJaw, 0.36, m, [
        -1.16,
        1.0,
        0.12
    ], [
        0,
        0,
        -0.03
    ], 1.025);
    addCurvedTube(arm, 'claw_upper_curved_shell', [
        [
            -1.02,
            1.57,
            0.32
        ],
        [
            -1.35,
            1.65,
            0.34
        ],
        [
            -1.7,
            1.48,
            0.34
        ],
        [
            -1.94,
            1.2,
            0.32
        ],
        [
            -1.92,
            0.92,
            0.32
        ],
        [
        -1.74,
            0.64,
            0.34
        ]
    ], 0.14, m.teal, 16);
    addCurvedTube(arm, 'claw_lower_curved_shell', [
        [
            -1.02,
            0.48,
            0.32
        ],
        [
            -1.34,
            0.38,
            0.34
        ],
        [
            -1.68,
            0.5,
            0.34
        ],
        [
            -1.92,
            0.74,
            0.32
        ],
        [
            -1.92,
            0.98,
            0.32
        ],
        [
        -1.75,
            1.26,
            0.34
        ]
    ], 0.14, m.teal, 16);
    addCurvedTube(arm, 'claw_upper_brass_seam', [
        [
            -1.05,
            1.62,
            0.49
        ],
        [
            -1.38,
            1.68,
            0.5
        ],
        [
            -1.72,
            1.49,
            0.5
        ],
        [
            -1.9,
            1.18,
            0.49
        ]
    ], 0.022, m.brassBright, 8);
    addCurvedTube(arm, 'claw_lower_brass_seam', [
        [
            -1.05,
            0.43,
            0.49
        ],
        [
            -1.38,
            0.35,
            0.5
        ],
        [
            -1.7,
            0.5,
            0.5
        ],
        [
            -1.9,
            0.78,
            0.49
        ]
    ], 0.022, m.brassBright, 8);
    const toothPositions = [
        [
            -1.73,
            1.35,
            0.35
        ],
        [
            -1.78,
            1.22,
            0.35
        ],
        [
            -1.8,
            1.09,
            0.35
        ],
        [
            -1.8,
            0.94,
            0.35
        ],
        [
            -1.77,
            0.8,
            0.35
        ],
        [
            -1.72,
            0.66,
            0.35
        ]
    ];
    toothPositions.forEach((position, i)=>addMesh(arm, new THREE.ConeGeometry(0.055, 0.16, 8), m.tooth, `claw_tooth_${i}`, position, [
            0,
            0,
            -Math.PI / 2
        ]));
    addRivetRow(arm, 'claw_jaw_rivet', [
        [
            -1.45,
            1.5,
            0.38
        ],
        [
            -1.75,
            1.52,
            0.37
        ],
        [
            -1.97,
            1.31,
            0.35
        ],
        [
            -1.45,
            0.5,
            0.38
        ],
        [
            -1.75,
            0.49,
            0.37
        ],
        [
            -1.97,
            0.7,
            0.35
        ]
    ], m.brassBright, 0.04);
    addSocket(arm, 'socket_claw_vfx', [
        -1.84,
        1.0,
        0.35
    ]);
    rebasePivot(arm, [
        -0.78,
        2.82,
        0
    ]);
    arm.scale.set(0.92, 0.95, 0.95);
}
function buildCannonArm(root, m) {
    const arm = new THREE.Group();
    arm.name = 'pivot_right_arm';
    root.add(arm);
    addTaperedTube(arm, 'right_upper_arm_cloth', [
        0.82,
        2.78,
        0
    ], [
        1.08,
        2.25,
        0.02
    ], 0.24, 0.21, m.cloth, 18);
    addRing(arm, 'right_elbow_ring', [
        1.09,
        2.2,
        0
    ], 0.24, 0.045, m.brass, [
        Math.PI / 2,
        0,
        0.22
    ]);
    const start = [
        1.08,
        2.23,
        0.03
    ];
    const end = [
        1.58,
        0.58,
        0.55
    ];
    addTaperedTube(arm, 'cannon_core', start, end, 0.25, 0.31, m.darkMetal, 24);
    addTaperedTube(arm, 'cannon_teal_shroud', [
        1.12,
        2.13,
        0.04
    ], [
        1.42,
        0.92,
        0.47
    ], 0.3, 0.34, m.teal, 24);
    const axis = new THREE.Vector3().subVectors(new THREE.Vector3().fromArray(end), new THREE.Vector3().fromArray(start)).normalize();
    const ringCenters = [
        0.12,
        0.36,
        0.61,
        0.83
    ].map((t)=>new THREE.Vector3().fromArray(start).lerp(new THREE.Vector3().fromArray(end), t));
    ringCenters.forEach((center, index)=>{
        const group = new THREE.Group();
        group.name = `cannon_ring_group_${index}`;
        group.position.copy(center);
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
        arm.add(group);
        addRing(group, `cannon_ring_${index}`, [
            0,
            0,
            0
        ], 0.32 + index * 0.01, 0.042, index % 2 ? m.tealEdge : m.brass);
    });
    const muzzleGroup = new THREE.Group();
    muzzleGroup.name = 'pivot_cannon_muzzle';
    muzzleGroup.position.fromArray(end);
    muzzleGroup.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
    arm.add(muzzleGroup);
    addMesh(muzzleGroup, new THREE.CylinderGeometry(0.34, 0.38, 0.24, 28, 1, true), m.tealDark, 'cannon_muzzle_shell');
    addRing(muzzleGroup, 'cannon_muzzle_brass_lip', [
        0,
        0.125,
        0
    ], 0.36, 0.05, m.brassBright);
    addMesh(muzzleGroup, new THREE.CylinderGeometry(0.24, 0.24, 0.045, 28), m.visor, 'cannon_bore', [
        0,
        0.145,
        0
    ]);
    for(let row = 0; row < 4; row += 1)for(let col = 0; col < 3; col += 1)addRivet(arm, `cannon_grid_rivet_${row}_${col}`, [
        1.13 + col * 0.11 + row * 0.08,
        1.92 - row * 0.27,
        0.35
    ], m.brassBright, 0.027);
    addTube(arm, 'cannon_side_rail', [
        1.46,
        1.98,
        0.11
    ], [
        1.7,
        1.06,
        0.42
    ], 0.04, m.tealEdge, 10);
    addSocket(muzzleGroup, 'socket_muzzle_vfx', [
        0,
        -0.23,
        0
    ]);
    rebasePivot(arm, [
        0.78,
        2.82,
        0
    ]);
    arm.scale.set(0.92, 0.82, 0.94);
}
function buildWaistAndSkirt(root, m) {
    const waist = new THREE.Group();
    waist.name = 'pivot_pelvis';
    root.add(waist);
    addMesh(waist, new THREE.CapsuleGeometry(0.49, 0.38, 10, 20), m.cloth, 'pelvis_cloth', [
        0,
        1.61,
        -0.03
    ], [
        0,
        0,
        0
    ], [
        1.46,
        1.08,
        0.94
    ]);
    addTube(waist, 'rope_belt_upper', [
        -0.62,
        1.92,
        0.28
    ], [
        0.62,
        1.92,
        0.28
    ], 0.045, m.rope, 10);
    addTube(waist, 'rope_belt_lower', [
        -0.62,
        1.83,
        0.31
    ], [
        0.62,
        1.83,
        0.31
    ], 0.045, m.rope, 10);
    addRing(waist, 'rope_knot_left', [
        -0.13,
        1.78,
        0.39
    ], 0.12, 0.035, m.rope, [
        0,
        0,
        0
    ]);
    addRing(waist, 'rope_knot_right', [
        0.13,
        1.78,
        0.39
    ], 0.12, 0.035, m.rope, [
        0,
        0,
        0
    ]);
    addTube(waist, 'rope_tassel_left', [
        -0.08,
        1.72,
        0.39
    ], [
        -0.2,
        1.32,
        0.39
    ], 0.025, m.rope, 8);
    addTube(waist, 'rope_tassel_right', [
        0.08,
        1.72,
        0.39
    ], [
        0.22,
        1.38,
        0.39
    ], 0.025, m.rope, 8);
    const skirtLeft = [
        [
            -0.05,
            0.36
        ],
        [
            -0.53,
            0.28
        ],
        [
            -0.64,
            -0.43
        ],
        [
            -0.2,
            -0.6
        ],
        [
            0.05,
            -0.28
        ]
    ];
    const skirtRight = [
        [
            0.05,
            0.36
        ],
        [
            0.53,
            0.28
        ],
        [
            0.64,
            -0.43
        ],
        [
            0.2,
            -0.6
        ],
        [
            -0.05,
            -0.28
        ]
    ];
    addTrimmedPlate(waist, 'left_hip_skirt', skirtLeft, 0.2, m, [
        -0.05,
        1.62,
        0.16
    ], [
        0,
        0.06,
        -0.04
    ], 1.035);
    addTrimmedPlate(waist, 'right_hip_skirt', skirtRight, 0.2, m, [
        0.05,
        1.62,
        0.16
    ], [
        0,
        -0.06,
        0.04
    ], 1.035);
    const tasset = [
        [
            -0.3,
            0.42
        ],
        [
            0.3,
            0.42
        ],
        [
            0.27,
            -0.68
        ],
        [
            0,
            -0.82
        ],
        [
            -0.27,
            -0.68
        ]
    ];
    addPlate(waist, 'front_tasset_trim', tasset, 0.11, m.brass, [
        0,
        1.52,
        0.4
    ], [
        0,
        0,
        0
    ], 0.025);
    const tassetInset = tasset.map(([x, y])=>[
            x * 0.88,
            y * 0.9
        ]);
    addPlate(waist, 'front_tasset_cloth', tassetInset, 0.12, m.clothLight, [
        0,
        1.52,
        0.44
    ], [
        0,
        0,
        0
    ], 0.02);
    addOutline(waist, 'front_tasset_inner_trim', tassetInset.map(([x, y])=>[
            x,
            y + 1.52
        ]), 0.52, 0.015, m.brassBright);
    addTube(waist, 'tasset_glyph_vertical', [
        0,
        1.64,
        0.54
    ], [
        0,
        1.02,
        0.54
    ], 0.018, m.brass, 8);
    addTube(waist, 'tasset_glyph_left', [
        0,
        1.45,
        0.54
    ], [
        -0.12,
        1.34,
        0.54
    ], 0.016, m.brass, 8);
    addTube(waist, 'tasset_glyph_right', [
        0,
        1.45,
        0.54
    ], [
        0.12,
        1.34,
        0.54
    ], 0.016, m.brass, 8);
    addRivetRow(waist, 'skirt_rivet', [
        [
            -0.48,
            1.73,
            0.38
        ],
        [
            -0.39,
            1.31,
            0.4
        ],
        [
            0.48,
            1.73,
            0.38
        ],
        [
            0.39,
            1.31,
            0.4
        ]
    ], m.brassBright, 0.03);
    rebasePivot(waist, [
        0,
        1.86,
        0
    ]);
}
function buildLeg(root, m, side) {
    const sign = side === 'left' ? -1 : 1;
    const leg = new THREE.Group();
    leg.name = `pivot_${side}_leg`;
    root.add(leg);
    addMesh(leg, new THREE.SphereGeometry(0.39, 24, 18), m.cloth, `${side}_pants_volume`, [
        sign * 0.39,
        1.4,
        -0.02
    ], [
        0,
        0,
        0
    ], [
        1.18,
        1.25,
        1.02
    ]);
    addTaperedTube(leg, `${side}_thigh_cloth`, [
        sign * 0.37,
        1.57,
        -0.02
    ], [
        sign * 0.39,
        1.04,
        0
    ], 0.36, 0.3, m.cloth, 20);
    addRing(leg, `${side}_knee_ring`, [
        sign * 0.37,
        1.02,
        0.02
    ], 0.22, 0.04, m.brass);
    const knee = sign < 0 ? [
        [
            -0.05,
            0.23
        ],
        [
            -0.3,
            0.14
        ],
        [
            -0.3,
            -0.16
        ],
        [
            -0.04,
            -0.24
        ],
        [
            0.13,
            0
        ]
    ] : [
        [
            0.05,
            0.23
        ],
        [
            0.3,
            0.14
        ],
        [
            0.3,
            -0.16
        ],
        [
            0.04,
            -0.24
        ],
        [
            -0.13,
            0
        ]
    ];
    addTrimmedPlate(leg, `${side}_knee_guard`, knee, 0.16, m, [
        sign * 0.37,
        1.02,
        0.2
    ], [
        0,
        0,
        0
    ], 1.04);
    addTaperedTube(leg, `${side}_shin_core`, [
        sign * 0.38,
        0.94,
        0
    ], [
        sign * 0.39,
        0.34,
        0.04
    ], 0.24, 0.19, m.cloth, 18);
    const shin = [
        [
            -0.18,
            0.34
        ],
        [
            0.18,
            0.34
        ],
        [
            0.21,
            -0.25
        ],
        [
            0.11,
            -0.37
        ],
        [
            -0.11,
            -0.37
        ],
        [
            -0.21,
            -0.25
        ]
    ];
    addMesh(leg, new THREE.SphereGeometry(0.25, 24, 16), m.teal, `${side}_shin_curved_shell`, [
        sign * 0.39,
        0.65,
        0.12
    ], [
        0,
        0,
        0
    ], [
        1.1,
        1.46,
        0.88
    ]);
    addTrimmedPlate(leg, `${side}_shin_guard`, shin.map(([x, y])=>[
            x * 0.75,
            y * 0.9
        ]), 0.09, m, [
        sign * 0.38,
        0.66,
        0.38
    ], [
        0,
        0,
        0
    ], 1.02);
    addTube(leg, `${side}_shin_rope_left`, [
        sign * 0.5,
        0.92,
        0.36
    ], [
        sign * 0.5,
        0.45,
        0.36
    ], 0.021, m.rope, 8);
    addTube(leg, `${side}_shin_rope_right`, [
        sign * 0.27,
        0.92,
        0.36
    ], [
        sign * 0.27,
        0.45,
        0.36
    ], 0.021, m.rope, 8);
    addTube(leg, `${side}_shin_rope_cross_a`, [
        sign * 0.24,
        0.82,
        0.37
    ], [
        sign * 0.52,
        0.6,
        0.37
    ], 0.018, m.rope, 8);
    addTube(leg, `${side}_shin_rope_cross_b`, [
        sign * 0.52,
        0.82,
        0.37
    ], [
        sign * 0.24,
        0.6,
        0.37
    ], 0.018, m.rope, 8);
    addMesh(leg, new THREE.CapsuleGeometry(0.18, 0.32, 8, 16), m.darkMetal, `${side}_boot_core`, [
        sign * 0.39,
        0.17,
        0.27
    ], [
        Math.PI / 2,
        0,
        0
    ], [
        1.05,
        1,
        1.08
    ]);
    addMesh(leg, new THREE.SphereGeometry(0.22, 24, 14), m.tealDark, `${side}_boot_curved_shell`, [
        sign * 0.39,
        0.16,
        0.47
    ], [
        0,
        0,
        0
    ], [
        1.28,
        0.56,
        1.46
    ]);
    addMesh(leg, new THREE.SphereGeometry(0.12, 18, 10), m.teal, `${side}_boot_outer_toe`, [
        sign * 0.53,
        0.16,
        0.62
    ], [
        0,
        0,
        0
    ], [
        1.05,
        0.5,
        1.15
    ]);
    addMesh(leg, new THREE.SphereGeometry(0.11, 18, 10), m.teal, `${side}_boot_inner_toe`, [
        sign * 0.29,
        0.16,
        0.63
    ], [
        0,
        0,
        0
    ], [
        0.95,
        0.48,
        1.1
    ]);
    [
        -0.15,
        0,
        0.15
    ].forEach((offset, index)=>addTube(leg, `${side}_toe_ridge_${index}`, [
            sign * 0.39 + offset,
            0.12,
            0.61
        ], [
            sign * 0.39 + offset,
            0.28,
            0.61
        ], 0.025, m.brass, 8));
    addSocket(leg, `socket_${side}_foot_vfx`, [
        sign * 0.39,
        0.08,
        0.5
    ]);
    rebasePivot(leg, [
        sign * 0.36,
        1.58,
        0
    ]);
    leg.scale.set(0.98, 1.28, 1.02);
}
export function createShiomanekiPlayableHeroModel(options = {}) {
    const root = new THREE.Group();
    root.name = 'shiomaneki_playable_hero';
    root.userData.heroId = 'shiomaneki';
    const m = makeMaterials();
    buildTorso(root, m);
    buildHead(root, m);
    buildShoulder(root, m, 'left');
    buildShoulder(root, m, 'right');
    buildClawArm(root, m);
    buildCannonArm(root, m);
    buildWaistAndSkirt(root, m);
    buildLeg(root, m, 'left');
    buildLeg(root, m, 'right');
    addSocket(root, 'socket_root_vfx', [
        0,
        2.1,
        0
    ]);
    const pivots = {
        root: root.name,
        head: 'pivot_head',
        torso: 'pivot_torso',
        pelvis: 'pivot_pelvis',
        leftShoulder: 'pivot_left_shoulder',
        rightShoulder: 'pivot_right_shoulder',
        leftArm: 'pivot_left_arm',
        rightArm: 'pivot_right_arm',
        leftLeg: 'pivot_left_leg',
        rightLeg: 'pivot_right_leg'
    };
    const sockets = {
        weapon_primary: 'socket_muzzle_vfx',
        hand_off: 'socket_claw_vfx',
        back_accessory: 'socket_chest_vfx',
        vfx_origin: 'socket_root_vfx',
        muzzle: 'socket_muzzle_vfx',
        claw: 'socket_claw_vfx',
        chest: 'socket_chest_vfx',
        root: 'socket_root_vfx'
    };
    const colliderHints = {
        torso: {
            type: 'capsule',
            radius: 0.62,
            height: 1.45
        },
        head: {
            type: 'sphere',
            radius: 0.34
        }
    };
    const preservedGroups = [
        'pivot_cannon_muzzle'
    ];
    const optimization = Object.values(pivots).filter((name)=>name !== root.name).map((name)=>{
        const pivot = root.getObjectByName(name);
        if (!pivot) throw new Error(`missing semantic pivot before compaction: ${name}`);
        return {
            pivot: name,
            ...mergeStaticMeshesByMaterial(pivot, {
                preserveGroups: preservedGroups
            })
        };
    });
    const muzzlePivot = root.getObjectByName('pivot_cannon_muzzle');
    if (muzzlePivot) {
        optimization.push({
            pivot: muzzlePivot.name,
            ...mergeStaticMeshesByMaterial(muzzlePivot)
        });
    }
    root.userData.characterModel = {
        schemaVersion: '1.0.0',
        heroId: 'shiomaneki',
        implementation: 'handcrafted-img2threejs-structure-pass',
        coordinateSystem: 'three-y-up-front-positive-z',
        pivots,
        sockets,
        colliderHints,
        optimization: {
            strategy: 'per-pivot material merge',
            pivots: optimization
        },
        animation: {
            mode: 'procedural-pivots',
            locomotion: [
                'idle',
                'walk',
                'run',
                'crouch',
                'air',
                'death'
            ],
            combat: [
                'fire',
                'cast'
            ]
        }
    };
    root.userData.sculptRuntime = {
        targetName: 'Shiomaneki Playable Hero',
        implementation: 'handcrafted-img2threejs-structure-pass',
        pivots,
        sockets,
        colliderHints
    };
    root.traverse((object)=>{
        if (object.isMesh) {
            object.castShadow = options.castShadow ?? true;
            object.receiveShadow = options.receiveShadow ?? true;
        }
    });
    const measuredPerformance = measureModelPerformance(root);
    root.userData.characterModel.performance = {
        ...measuredPerformance,
        lod0TriangleBudget: 45000,
        mobileDrawCallBudget: 24
    };
    root.scale.x = 0.87;
    return root;
}
export function createShiomanekiPlayableHeroLookDevLights(preset = 'neutral') {
    const lights = new THREE.Group();
    lights.name = `shiomaneki_lights_${preset}`;
    const hemi = new THREE.HemisphereLight(0xb7d7e2, 0x18202a, 1.45);
    lights.add(hemi);
    const key = new THREE.DirectionalLight(0xffe4c2, 3.4);
    key.position.set(-3.5, 6.2, 5.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    lights.add(key);
    const fill = new THREE.DirectionalLight(0x6bb9dc, 1.8);
    fill.position.set(4, 3.5, 3);
    lights.add(fill);
    const rim = new THREE.DirectionalLight(0x9ad8cd, 2.4);
    rim.position.set(0, 4, -5);
    lights.add(rim);
    return lights;
}
