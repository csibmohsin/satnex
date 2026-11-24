import struct
import json
import math
import os

def create_box(x_min, x_max, y_min, y_max, z_min, z_max):
    # 6 faces * 4 vertices = 24 vertices
    # normals for each face
    faces = [
        # +X
        ([(x_max, y_min, z_min), (x_max, y_max, z_min), (x_max, y_max, z_max), (x_max, y_min, z_max)], (1, 0, 0)),
        # -X
        ([(x_min, y_min, z_max), (x_min, y_max, z_max), (x_min, y_max, z_min), (x_min, y_min, z_min)], (-1, 0, 0)),
        # +Y
        ([(x_min, y_max, z_min), (x_max, y_max, z_min), (x_max, y_max, z_max), (x_min, y_max, z_max)], (0, 1, 0)),
        # -Y
        ([(x_min, y_min, z_max), (x_max, y_min, z_max), (x_max, y_min, z_min), (x_min, y_min, z_min)], (0, -1, 0)),
        # +Z
        ([(x_min, y_min, z_max), (x_max, y_min, z_max), (x_max, y_max, z_max), (x_min, y_max, z_max)], (0, 0, 1)),
        # -Z
        ([(x_min, y_max, z_min), (x_max, y_max, z_min), (x_max, y_min, z_min), (x_min, y_min, z_min)], (0, 0, -1)),
    ]
    verts = []
    normals = []
    indices = []
    idx = 0
    for face_verts, n in faces:
        for v in face_verts:
            verts.append(v)
            normals.append(n)
        indices.extend([idx, idx + 1, idx + 2, idx, idx + 2, idx + 3])
        idx += 4
    return verts, normals, indices

def create_cylinder(x0, y0, z0, x1, y1, z1, radius, segments=12):
    # Cylinder along axis from (x0,y0,z0) to (x1,y1,z1)
    dx = x1 - x0
    dy = y1 - y0
    dz = z1 - z0
    length = math.sqrt(dx*dx + dy*dy + dz*dz)
    if length < 1e-6:
        return [], [], []
    ux, uy, uz = dx/length, dy/length, dz/length
    
    # find perpendicular vector
    if abs(ux) < 0.9:
        px, py, pz = 1, 0, 0
    else:
        px, py, pz = 0, 1, 0
    # cross u x p
    rx = uy*pz - uz*py
    ry = uz*px - ux*pz
    rz = ux*py - uy*px
    rlen = math.sqrt(rx*rx + ry*ry + rz*rz)
    rx, ry, rz = rx/rlen, ry/rlen, rz/rlen
    # cross u x r
    sx = uy*rz - uz*ry
    sy = uz*rx - ux*rz
    sz = ux*ry - uy*rx
    
    verts = []
    normals = []
    indices = []
    
    # Side quads
    for i in range(segments):
        a0 = 2 * math.pi * i / segments
        a1 = 2 * math.pi * (i + 1) / segments
        
        c0, s0 = math.cos(a0), math.sin(a0)
        c1, s1 = math.cos(a1), math.sin(a1)
        
        n0 = (c0*rx + s0*sx, c0*ry + s0*sy, c0*rz + s0*sz)
        n1 = (c1*rx + s1*sx, c1*ry + s1*sy, c1*rz + s1*sz)
        
        v0 = (x0 + radius*n0[0], y0 + radius*n0[1], z0 + radius*n0[2])
        v1 = (x1 + radius*n0[0], y1 + radius*n0[1], z1 + radius*n0[2])
        v2 = (x1 + radius*n1[0], y1 + radius*n1[1], z1 + radius*n1[2])
        v3 = (x0 + radius*n1[0], y0 + radius*n1[1], z0 + radius*n1[2])
        
        idx = len(verts)
        verts.extend([v0, v1, v2, v3])
        normals.extend([n0, n0, n1, n1])
        indices.extend([idx, idx + 1, idx + 2, idx, idx + 2, idx + 3])
        
    return verts, normals, indices

def create_dish(center_x, center_y, center_z, radius, depth=0.3, segments=16):
    # Parabolic dish facing +Z
    verts = []
    normals = []
    indices = []
    
    # apex at (0, 0, -depth)
    apex = (center_x, center_y, center_z - depth)
    verts.append(apex)
    normals.append((0, 0, -1))
    apex_idx = 0
    
    for i in range(segments):
        a = 2 * math.pi * i / segments
        ca, sa = math.cos(a), math.sin(a)
        x = center_x + radius * ca
        y = center_y + radius * sa
        z = center_z
        # normal of paraboloid z = (x^2+y^2)/(radius^2)*depth
        # grad is (-2*depth/radius^2 * x, -2*depth/radius^2 * y, 1) normalized
        nx = -ca * 0.7
        ny = -sa * 0.7
        nz = 0.7
        nlen = math.sqrt(nx*nx + ny*ny + nz*nz)
        verts.append((x, y, z))
        normals.append((nx/nlen, ny/nlen, nz/nlen))
    
    for i in range(segments):
        i0 = 1 + i
        i1 = 1 + ((i + 1) % segments)
        indices.extend([apex_idx, i0, i1])
        # back side
        indices.extend([apex_idx, i1, i0])
        
    return verts, normals, indices

def build_satellite_glb():
    # 1. Main Satellite Bus (Gold Foil)
    bus_v, bus_n, bus_i = create_box(-0.8, 0.8, -0.8, 0.8, -1.0, 1.0)
    
    # 2. Solar Panels (Deep Solar Blue with subtle border)
    # Left wing
    lp_v, lp_n, lp_i = create_box(-4.6, -1.3, -0.75, 0.75, -0.03, 0.03)
    # Right wing
    rp_v, rp_n, rp_i = create_box(1.3, 4.6, -0.75, 0.75, -0.03, 0.03)
    # Combine solar panels
    solar_v = lp_v + rp_v
    solar_n = lp_n + rp_n
    offset = len(lp_v)
    solar_i = lp_i + [idx + offset for idx in rp_i]
    
    # 3. Structural Booms & Mounts (Dark Titanium Carbon)
    b1_v, b1_n, b1_i = create_cylinder(-0.8, 0, 0, -1.3, 0, 0, 0.06, 8)
    b2_v, b2_n, b2_i = create_cylinder(0.8, 0, 0, 1.3, 0, 0, 0.06, 8)
    # Earth sensor optics tube on -Z face
    b3_v, b3_n, b3_i = create_cylinder(0, 0, -1.0, 0, 0, -1.45, 0.25, 12)
    # Antenna boom on +Y face
    b4_v, b4_n, b4_i = create_cylinder(0, 0.8, 0.4, 0, 1.3, 0.6, 0.04, 8)
    
    struct_v = b1_v + b2_v + b3_v + b4_v
    struct_n = b1_n + b2_n + b3_n + b4_n
    struct_i = b1_i[:]
    cur_off = len(b1_v)
    for part_v, part_i in [(b2_v, b2_i), (b3_v, b3_i), (b4_v, b4_i)]:
        struct_i.extend([idx + cur_off for idx in part_i])
        cur_off += len(part_v)
        
    # 4. Communications Parabolic Dish (High-Gain White Antenna Dish)
    dish_v, dish_n, dish_i = create_dish(0, 1.3, 0.6, 0.65, 0.22, 16)
    
    # Parts list: (verts, normals, indices, material_idx)
    parts = [
        (bus_v, bus_n, bus_i, 0),      # Gold Foil Bus
        (solar_v, solar_n, solar_i, 1), # Solar Panels
        (struct_v, struct_n, struct_i, 2), # Dark Structural Frame
        (dish_v, dish_n, dish_i, 3)     # White Parabolic Dish
    ]
    
    # Materials:
    materials = [
        {
            "name": "GoldFoilMLI",
            "pbrMetallicRoughness": {
                "baseColorFactor": [1.0, 0.82, 0.30, 1.0],
                "metallicFactor": 0.88,
                "roughnessFactor": 0.22
            }
        },
        {
            "name": "SolarCellArray",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.06, 0.24, 0.72, 1.0],
                "metallicFactor": 0.65,
                "roughnessFactor": 0.25
            }
        },
        {
            "name": "CarbonTruss",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.18, 0.20, 0.24, 1.0],
                "metallicFactor": 0.4,
                "roughnessFactor": 0.6
            }
        },
        {
            "name": "AntennaDish",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.95, 0.95, 0.98, 1.0],
                "metallicFactor": 0.2,
                "roughnessFactor": 0.35
            }
        }
    ]
    
    bin_buffer = bytearray()
    buffer_views = []
    accessors = []
    meshes = []
    
    for v_list, n_list, i_list, mat_idx in parts:
        # 1. POSITION
        pos_bytes = bytearray()
        min_p = [float('inf')]*3
        max_p = [float('-inf')]*3
        for vx, vy, vz in v_list:
            pos_bytes.extend(struct.pack('<fff', vx, vy, vz))
            min_p[0] = min(min_p[0], vx)
            min_p[1] = min(min_p[1], vy)
            min_p[2] = min(min_p[2], vz)
            max_p[0] = max(max_p[0], vx)
            max_p[1] = max(max_p[1], vy)
            max_p[2] = max(max_p[2], vz)
            
        pos_offset = len(bin_buffer)
        bin_buffer.extend(pos_bytes)
        # Pad to 4 bytes
        while len(bin_buffer) % 4 != 0:
            bin_buffer.append(0)
            
        pos_bv_idx = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": pos_offset,
            "byteLength": len(pos_bytes),
            "target": 34962 # ARRAY_BUFFER
        })
        pos_acc_idx = len(accessors)
        accessors.append({
            "bufferView": pos_bv_idx,
            "byteOffset": 0,
            "componentType": 5126, # FLOAT
            "count": len(v_list),
            "type": "VEC3",
            "min": min_p,
            "max": max_p
        })
        
        # 2. NORMAL
        norm_bytes = bytearray()
        for nx, ny, nz in n_list:
            norm_bytes.extend(struct.pack('<fff', nx, ny, nz))
            
        norm_offset = len(bin_buffer)
        bin_buffer.extend(norm_bytes)
        while len(bin_buffer) % 4 != 0:
            bin_buffer.append(0)
            
        norm_bv_idx = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": norm_offset,
            "byteLength": len(norm_bytes),
            "target": 34962
        })
        norm_acc_idx = len(accessors)
        accessors.append({
            "bufferView": norm_bv_idx,
            "byteOffset": 0,
            "componentType": 5126,
            "count": len(n_list),
            "type": "VEC3"
        })
        
        # 3. INDICES
        idx_bytes = bytearray()
        for idx in i_list:
            idx_bytes.extend(struct.pack('<H', idx))
            
        idx_offset = len(bin_buffer)
        bin_buffer.extend(idx_bytes)
        while len(bin_buffer) % 4 != 0:
            bin_buffer.append(0)
            
        idx_bv_idx = len(buffer_views)
        buffer_views.append({
            "buffer": 0,
            "byteOffset": idx_offset,
            "byteLength": len(idx_bytes),
            "target": 34963 # ELEMENT_ARRAY_BUFFER
        })
        idx_acc_idx = len(accessors)
        accessors.append({
            "bufferView": idx_bv_idx,
            "byteOffset": 0,
            "componentType": 5123, # UNSIGNED_SHORT
            "count": len(i_list),
            "type": "SCALAR"
        })
        
        # Mesh
        mesh_idx = len(meshes)
        meshes.append({
            "primitives": [{
                "attributes": {
                    "POSITION": pos_acc_idx,
                    "NORMAL": norm_acc_idx
                },
                "indices": idx_acc_idx,
                "material": mat_idx,
                "mode": 4 # TRIANGLES
            }]
        })
        
    nodes = []
    node_indices = []
    for m_idx in range(len(meshes)):
        nodes.append({
            "mesh": m_idx
        })
        node_indices.append(m_idx)
        
    gltf_json = {
        "asset": {
            "version": "2.0",
            "generator": "SATNEX Spacecraft 3D Generator"
        },
        "scene": 0,
        "scenes": [{
            "nodes": node_indices
        }],
        "nodes": nodes,
        "materials": materials,
        "meshes": meshes,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{
            "byteLength": len(bin_buffer)
        }]
    }
    
    json_str = json.dumps(gltf_json, separators=(',', ':'))
    json_bytes = json_str.encode('utf-8')
    # Pad JSON to 4-byte boundary with spaces (0x20)
    while len(json_bytes) % 4 != 0:
        json_bytes += b' '
        
    # Build GLB binary
    glb_header = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(json_bytes) + 8 + len(bin_buffer))
    json_chunk_hdr = struct.pack('<II', len(json_bytes), 0x4E4F534A) # JSON
    bin_chunk_hdr = struct.pack('<II', len(bin_buffer), 0x004E4942)   # BIN\0
    
    glb_data = glb_header + json_chunk_hdr + json_bytes + bin_chunk_hdr + bin_buffer
    
    out_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), "public", "models", "satellite.glb")
    with open(out_path, "wb") as f:
        f.write(glb_data)
        
    print(f"[OK] Generated Satellite 3D GLB model at {out_path} ({len(glb_data)} bytes)")

if __name__ == "__main__":
    build_satellite_glb()

