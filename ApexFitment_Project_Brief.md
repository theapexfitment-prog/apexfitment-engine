# ApexFitment — Project Brief & Technical Reference
**Versión:** 1.0 · **Fecha:** Mayo 2026  
**Propósito:** Documento de referencia completo para retomar contexto en Claude Code

---

## 1. IDENTIDAD DEL PROYECTO

| Campo | Valor |
|---|---|
| **Nombre del producto** | ApexFitment |
| **Nombre anterior** | LeadMechanic OS |
| **Tagline** | Deterministic Compatibility. Zero Guesswork. |
| **Tipo de negocio** | B2B SaaS — infraestructura de software para Speed Shops |
| **Mercado objetivo** | Speed Shops especializados en American Muscle · Texas · EE.UU. |
| **Plataformas cubiertas** | Ford Coyote · GM LS/LT · Chrysler Hemi · Restomods · Clásicos con swaps |
| **Dirección física** | 5300 N Braeswood Blvd Ste 4-782 · Houston, TX 77096 |
| **Dominio** | apexfitment.com |
| **Instagram** | @apexfitment.engine |
| **Email** | apexfitment@gmail.com |

---

## 2. PROBLEMA QUE RESUELVE

Los Speed Shops de alto rendimiento pierden dinero cuando ordenan piezas aftermarket que no fitean en builds modificados. Una sola cotización puede involucrar 8–12 variables mecánicas simultáneas que ninguna base de datos OEM cubre:

1. Engine generation (LS1 vs LS3 vs LS7 vs LSX)
2. Subchasis year (S197 vs S550 vs S650)
3. Transmisión (T56 vs TR6060 vs TREMEC Magnum)
4. Header tube diameter (1-3/4" vs 1-7/8")
5. A/C & power steering retention
6. Boost level en configuración existente
7. Drivetrain (IRS vs solid axle)
8. Swap platform (LS-in-SN95, Coyote-in-Fox)

**Competidores principales y su falla:** Tekmetric, Shopmonkey, Mitchell1, ALLDATA — todos construidos sobre Year/Make/Model OEM. No cubren builds modificados ni engine swaps.

---

## 3. ARQUITECTURA TÉCNICA

### Stack
- **Runtime:** Node.js v24.15.0
- **Framework:** Express.js
- **Base de datos:** SQLite3 (local) — pendiente migrar a PostgreSQL en Railway
- **PDF Generation:** PDFKit
- **XML Parsing:** xml2js (para importación ACES)
- **Frontend:** HTML/CSS vanilla con JetBrains Mono font

### Directorio del proyecto
```
c:\Users\52438\.gemini\antigravity\scratch\leadmechanic-core\
├── data/
│   └── sample_aces.xml          ← 20 productos de muestra en formato ACES 3.0
├── database/
│   └── leadmechanic.db          ← SQLite con 39+ productos seedeados
├── src/
│   ├── init_db.js               ← Crea tablas y seedea productos iniciales
│   ├── truck_estimator.js       ← Servidor Express + todos los endpoints
│   ├── pdf_generator.js         ← Generador de PDF con PDFKit
│   └── aces_parser.js           ← Parser ACES XML → SQLite
├── public/
│   └── index.html               ← UI premium dark terminal
└── package.json
```

### Comandos principales
```powershell
# Navegar al proyecto
cd "c:\Users\52438\.gemini\antigravity\scratch\leadmechanic-core"

# Inicializar/resetear base de datos
node src/init_db.js

# Levantar servidor
node src/truck_estimator.js

# Importar archivo ACES
node src/aces_parser.js data/sample_aces.xml
node src/aces_parser.js path\to\real_sema_file.xml

# Matar puerto 3000 si está ocupado
npx kill-port 3000

# Acceder al sistema
http://localhost:3000
```

---

## 4. ESQUEMA DE BASE DE DATOS

### Tabla: products
```sql
CREATE TABLE products (
  product_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  part_number       TEXT    NOT NULL UNIQUE,
  brand             TEXT    NOT NULL,
  line_name         TEXT,
  product_type      TEXT    NOT NULL,
  diameter_inches   REAL    NOT NULL,
  material          TEXT,
  base_price_usd    REAL    NOT NULL
);
```

### Tabla: exhaust_fitment
```sql
CREATE TABLE exhaust_fitment (
  fitment_id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id              INTEGER NOT NULL REFERENCES products(product_id),
  fit_year                INTEGER NOT NULL,
  fit_make                TEXT    NOT NULL,
  fit_model               TEXT    NOT NULL,
  fit_payload_chassis     TEXT,
  fit_cab_type            TEXT,
  fit_bed_length          TEXT,
  fit_engine_displacement TEXT,
  fit_drivetrain          TEXT
);
```

### Tabla: labor_rates
```sql
CREATE TABLE labor_rates (
  product_type    TEXT PRIMARY KEY,
  labor_hours     REAL NOT NULL,
  rate_per_hour   REAL NOT NULL DEFAULT 125.00
);
```

### Labor rates seedeadas
| Product Type | Labor Hours | Rate/hr |
|---|---|---|
| Cat-Back | 1.5h | $125 |
| Long Tube Headers | 4.0h | $125 |
| Supercharger Kit | 8.0h | $125 |
| Cold Air Intake | 0.5h | $125 |
| Camshaft Kit | 6.0h | $125 |
| Transmission | 10.0h | $125 |

---

## 5. ENDPOINTS DE LA API

### GET /health
Health check del servidor.
```json
{ "status": "ok", "service": "apexfitment-core" }
```

### POST /webhook/sms — Compatibility Query
Devuelve todas las piezas compatibles para un build.

**Request:**
```json
{
  "vehicle_chassis": {
    "year": 2018,
    "make": "Ford",
    "model": "Mustang GT",
    "submodel_payload_chassis": "GT",
    "cab_type": null,
    "bed_length": null,
    "drivetrain": "RWD"
  },
  "powertrain": {
    "engine_displacement_liters": "5.0L"
  }
}
```

**Response 200:**
```json
{
  "status": "MATCH_FOUND",
  "count": 7,
  "results": [...]
}
```

**Response 404:**
```json
{
  "status": "NO_MATCH",
  "message": "No compatible fitment found for the specified build configuration.",
  "query": {...}
}
```

### POST /quote — Quote with Labor
Igual que /webhook/sms pero incluye cálculo de labor y acepta filtro por tipo.

**Request adicional:**
```json
{
  "product_type_filter": "Long Tube Headers",
  "selected_part_numbers": ["LTH-COYOTE-S550", "SC-TVS2650-COYOTE"]
}
```

**Response 200:**
```json
{
  "status": "QUOTE_READY",
  "build": {...},
  "line_items": [
    {
      "part_number": "LTH-COYOTE-S550",
      "brand": "Kooks",
      "line_name": "Green Catted",
      "product_type": "Long Tube Headers",
      "base_price_usd": 1899.99,
      "labor_hours": 4.0,
      "labor_cost_usd": 500.00,
      "line_total_usd": 2399.99
    }
  ],
  "summary": {
    "parts_total_usd": 17349.94,
    "labor_total_usd": 3750.00,
    "grand_total_usd": 21099.94,
    "currency": "USD"
  }
}
```

### POST /export-pdf — PDF Export
Misma lógica que /quote pero devuelve PDF descargable.

**Headers de respuesta:**
```
Content-Type: application/pdf
Content-Disposition: attachment; filename="ApexFitment-Quote-Ford-Mustang-GT-2018.pdf"
```

---

## 6. LÓGICA NULL-TOLERANTE (CRÍTICA)

El engine usa lógica de tres paths para campos opcionales:

```sql
AND (? IS NULL OR f.fit_payload_chassis IS NULL OR f.fit_payload_chassis = ?)
```

| Cliente envía | DB tiene | Resultado |
|---|---|---|
| null | '1500HD' | ✅ skip filter |
| '1500HD' | '1500HD' | ✅ match |
| '2500HD' | '1500HD' | ❌ no match |
| null | null | ✅ match |

**IMPORTANTE:** Cada campo opcional bindea su parámetro DOS VECES en el array.

---

## 7. PRODUCTOS EN BASE DE DATOS

### Productos seedeados en init_db.js (15 productos)
| Part # | Brand | Type | Vehicle | Price |
|---|---|---|---|---|
| 15795 | Magnaflow | Cat-Back | 2004 GMC Sierra 1500 5.3L | $489.99 |
| 817540 | Flowmaster | Cat-Back | 2001 Chevy Silverado 1500HD 6.0L | $379.99 |
| LTH-LS-5700 | Hooker | Long Tube Headers | 2000 Chevy Silverado 1500 5.7L RWD | $1,199.99 |
| CB-COYOTE-GT | Borla | Cat-Back | 2018 Ford Mustang GT 5.0L | $1,349.99 |
| CB-HELLCAT-68 | Magnaflow | Cat-Back | 2019 Dodge Challenger SRT Hellcat 6.2L | $1,599.99 |
| LTH-COYOTE-S550 | Kooks | Long Tube Headers | 2018 Ford Mustang GT 5.0L | $1,899.99 |
| LTH-LS3-CAMARO | Hooker | Long Tube Headers | 2012 Chevy Camaro SS 6.2L | $1,249.99 |
| LTH-HEMI-392 | ARH | Long Tube Headers | 2020 Dodge Challenger R/T Scat Pack 6.4L | $1,449.99 |
| SC-TVS2650-COYOTE | Whipple | Supercharger Kit | 2018 Ford Mustang GT 5.0L | $8,499.99 |
| SC-TVS1900-LS3 | Edelbrock | Supercharger Kit | 2012 Chevy Camaro SS 6.2L | $6,299.99 |
| CAI-COYOTE-GT | Roush | Cold Air Intake | 2018 Ford Mustang GT 5.0L | $399.99 |
| CAI-HEMI-CHARGER | K&N | Cold Air Intake | 2019 Dodge Charger R/T 5.7L | $449.99 |
| CAM-LS3-STAGE2 | Texas Speed | Camshaft Kit | 2012 Chevy Camaro SS 6.2L | $649.99 |
| CAM-COYOTE-VMP | VMP Performance | Camshaft Kit | 2018 Ford Mustang GT 5.0L | $899.99 |
| TR-TREMEC-T56MAG | TREMEC | Transmission | 2018 Ford Mustang GT RWD | $4,299.99 |

### Productos Hellcat agregados manualmente (4 productos)
| Part # | Brand | Type | Price |
|---|---|---|---|
| LTH-HEMI-HELLCAT | ARH | Long Tube Headers | $1,649.99 |
| SC-HELLCAT-UPGRADE | Whipple | Supercharger Kit | $5,999.99 |
| CAI-HELLCAT-K&N | K&N | Cold Air Intake | $449.99 |
| CAM-HELLCAT-COMP | Comp Cams | Camshaft Kit | $899.99 |

### Productos importados vía ACES parser (20 productos)
Plataformas: Mustang GT S550 · Camaro SS 5th Gen · Challenger · Silverado · Corvette C7
Brands: Hooker · Borla · Kooks · Flowmaster · Edelbrock

**Total en DB: 39 productos**

---

## 8. PARSER ACES

El parser importa archivos ACES 3.0 XML directamente a SQLite.

```powershell
# Importar archivo de SEMA Data cuando llegue la aprobación
node src/aces_parser.js path\to\hooker_catalog.xml
node src/aces_parser.js path\to\borla_catalog.xml
```

**Mapeo de campos ACES → DB:**
| ACES Field | DB Field |
|---|---|
| MfrLabel | part_number |
| Brand | brand |
| PartType | product_type |
| Price | base_price_usd |
| Material | material |
| Diameter | diameter_inches |
| Note (first 60 chars) | line_name |
| Year | fit_year |
| Make | fit_make |
| Model + SubModel | fit_model |
| EngineDisplacement | fit_engine_displacement |
| Drivetrain | fit_drivetrain |

---

## 9. QUOTES DE REFERENCIA (DEMOS)

### Mustang GT 2018 5.0L — Full Build
- **Input:** year=2018, make=Ford, model=Mustang GT, engine=5.0L
- **Productos:** 7 line items
- **Parts Total:** $17,349.94
- **Labor Total:** $3,750.00
- **Grand Total:** $23,499.93
- **Query time:** ~16ms

### Challenger SRT Hellcat 2019 6.2L
- **Input:** year=2019, make=Dodge, model=Challenger, submodel=SRT Hellcat, engine=6.2L
- **Productos:** 5 line items
- **Parts Total:** $10,599.95
- **Labor Total:** $2,500.00
- **Grand Total:** $13,099.95

### Camaro SS 2019 6.2L
- **Input:** year=2019, make=Chevrolet, model=Camaro SS, engine=6.2L
- **Productos:** 4 line items
- **Grand Total:** $12,424.96

---

## 10. PENDIENTES CRÍTICOS

### Para poder cobrar (prioridad máxima)
- [ ] **Deploy en Railway/Render** — sacar el sistema de localhost
- [ ] **Autenticación básica** — login por shop
- [ ] **Dominio apuntando al servidor** — apexfitment.com → Railway

### Para escalar datos
- [ ] **Aprobación SEMA Data** — registro enviado, pendiente aprobación
- [ ] **Integrar catálogos reales** — Hooker, Borla, Kooks, Whipple, Flowmaster

### Para el producto
- [ ] **Historial de cotizaciones** — tabla quotes en DB
- [ ] **NLP real** — input en lenguaje natural via Claude API
- [ ] **Multi-tenant** — datos aislados por shop

---

## 11. PIPELINE DE PROSPECTOS (Estado actual)

| Shop | Ciudad | Status | Canal | Siguiente acción |
|---|---|---|---|---|
| SeriousHP | Houston TX | DM enviado | Instagram DM | Esperar respuesta |
| Bumbera's Performance | Sealy TX | Comentario enviado | Instagram @enginebuildermag | Esperar respuesta |
| M2K Motorsports | Katy TX | Comentario enviado | Instagram @precisionturbo | Esperar respuesta |
| Crane Speed & Performance | Houston TX | Comentario enviado | Instagram | Esperar respuesta |
| PowerFab Autosports | Spring TX | Comentario enviado | Instagram | Esperar respuesta |
| Texas Speed & Performance | Georgetown TX | Email enviado | Email a michael@texas-speed.com | Esperar respuesta |

---

## 12. INFRAESTRUCTURA DE MARCA

| Activo | Estado |
|---|---|
| Dominio apexfitment.com | ✅ Registrado en Namecheap |
| Instagram @apexfitment.engine | ✅ Activo · Logo profesional |
| Dirección Houston TX | ✅ iPostal1 · $10/mes |
| SEMA Data Co-op | ⏳ Pendiente aprobación |
| Logo | ✅ Generado en Higgsfield |
| Deck de ventas | ✅ apexfitment_deck.html |

---

## 13. CONTEXTO PARA CLAUDE CODE

Cuando abras una nueva sesión en Claude Code, pega esto al inicio:

> "Continuamos el desarrollo de ApexFitment — motor de compatibilidad determinista para Speed Shops en Texas. El proyecto está en c:\Users\52438\.gemini\antigravity\scratch\leadmechanic-core. Stack: Node.js + Express + SQLite3 + PDFKit. Lee este documento completo antes de cualquier modificación. El sistema tiene 3 endpoints principales: /webhook/sms (compatibility query), /quote (quote con labor), /export-pdf (PDF download). La lógica NULL-tolerante en SQL es crítica — no modificar sin entender la truth table en la sección 6."

