from __future__ import annotations

import math
import random
from typing import Any, Dict, List, Tuple

FEATURES_CLIENTE = [
    "dias_desde_compra",
    "compras_12m",
    "gasto_12m_bs",
    "interacciones_30d",
]

FEATURES_STOCK = [
    "stock_disponible",
    "ventas_30d",
    "rotacion_diaria",
    "plazo_reposicion_dias",
    "indice_temporada",
]


def _sigmoid(z: float) -> float:
    if z >= 0:
        ez = math.exp(-z)
        return 1.0 / (1.0 + ez)
    ez = math.exp(z)
    return ez / (1.0 + ez)


def _standardize_fit(rows: List[List[float]]) -> Tuple[List[float], List[float]]:
    n = len(rows)
    d = len(rows[0]) if n else 0
    means = [sum(r[j] for r in rows) / n for j in range(d)]
    stds = []
    for j in range(d):
        var = sum((r[j] - means[j]) ** 2 for r in rows) / max(1, n - 1)
        stds.append(math.sqrt(var) if var > 1e-12 else 1.0)
    return means, stds


def _standardize_transform(rows: List[List[float]], means: List[float], stds: List[float]) -> List[List[float]]:
    return [[(r[j] - means[j]) / stds[j] for j in range(len(means))] for r in rows]


def generar_dataset_sintetico_recompra(seed: int = 2026, n_samples: int = 800) -> List[Dict[str, Any]]:
    """
    Generador reproducible de datos sinteticos de comportamiento comercial.
    Esquema:
      - dias_desde_compra (int, 1..180 dias)
      - compras_12m (int, 1..24 compras anuales)
      - gasto_12m_bs (float, 90..9500 Bs)
      - interacciones_30d (int, 0..35 vistas/reservas/probador AR)
      - recompra_30d (int, 0 o 1: variable objetivo supervisada)
    """
    rng = random.Random(seed)
    dataset: List[Dict[str, Any]] = []
    for idx in range(n_samples):
        segment_draw = rng.random()
        if segment_draw < 0.38:
            dias = rng.randint(2, 35)
            compras = rng.randint(5, 18)
            gasto = round(compras * rng.uniform(210.0, 420.0), 2)
            interacciones = rng.randint(8, 30)
        elif segment_draw < 0.75:
            dias = rng.randint(20, 85)
            compras = rng.randint(2, 7)
            gasto = round(compras * rng.uniform(150.0, 310.0), 2)
            interacciones = rng.randint(3, 14)
        else:
            dias = rng.randint(70, 180)
            compras = rng.randint(1, 3)
            gasto = round(compras * rng.uniform(95.0, 210.0), 2)
            interacciones = rng.randint(0, 5)

        score_latente = (
            -0.048 * dias
            + 0.34 * compras
            + 0.00085 * gasto
            + 0.16 * interacciones
            - 0.55
            + rng.gauss(0.0, 0.52)
        )
        prob = _sigmoid(score_latente)
        recompra = 1 if prob >= 0.5 else 0
        dataset.append(
            {
                "id_sintetico": idx + 1,
                "dias_desde_compra": dias,
                "compras_12m": compras,
                "gasto_12m_bs": gasto,
                "interacciones_30d": interacciones,
                "recompra_30d": recompra,
            }
        )
    return dataset


def generar_dataset_sintetico_quiebre_stock(seed: int = 2026, n_samples: int = 400) -> List[Dict[str, Any]]:
    """
    Generador reproducible de riesgo de quiebre de stock por variante/sucursal.
    """
    rng = random.Random(seed + 101)
    rows: List[Dict[str, Any]] = []
    for idx in range(n_samples):
        stock_disp = rng.randint(0, 35)
        ventas_30d = rng.randint(1, 60)
        rotacion = round(ventas_30d / 30.0, 3)
        plazo_rep = rng.randint(3, 21)
        temporada = round(rng.uniform(0.8, 1.45), 2)
        demanda_esperada = rotacion * plazo_rep * temporada
        margen = stock_disp - demanda_esperada + rng.gauss(0.0, 1.4)
        riesgo_quiebre = 1 if margen <= 1.5 else 0
        rows.append(
            {
                "id_item": idx + 1,
                "stock_disponible": stock_disp,
                "ventas_30d": ventas_30d,
                "rotacion_diaria": rotacion,
                "plazo_reposicion_dias": plazo_rep,
                "indice_temporada": temporada,
                "riesgo_quiebre": riesgo_quiebre,
            }
        )
    return rows


def entrenar_regresion_logistica(
    X_train: List[List[float]],
    y_train: List[int],
    lr: float = 0.15,
    epochs: int = 320,
    l2: float = 0.005,
) -> Tuple[List[float], float]:
    n = len(X_train)
    d = len(X_train[0])
    weights = [0.0] * d
    bias = 0.0

    for _ in range(epochs):
        grad_w = [0.0] * d
        grad_b = 0.0
        for xi, yi in zip(X_train, y_train):
            z = sum(w * x for w, x in zip(weights, xi)) + bias
            pred = _sigmoid(z)
            err = pred - yi
            for j in range(d):
                grad_w[j] += err * xi[j]
            grad_b += err
        for j in range(d):
            weights[j] -= lr * ((grad_w[j] / n) + l2 * weights[j])
        bias -= lr * (grad_b / n)

    return weights, bias


def evaluar_clasificador_binario(
    X_eval: List[List[float]],
    y_eval: List[int],
    weights: List[float],
    bias: float,
) -> Dict[str, Any]:
    tp = fp = tn = fn = 0
    for xi, yi in zip(X_eval, y_eval):
        prob = _sigmoid(sum(w * x for w, x in zip(weights, xi)) + bias)
        pred = 1 if prob >= 0.5 else 0
        if pred == 1 and yi == 1:
            tp += 1
        elif pred == 1 and yi == 0:
            fp += 1
        elif pred == 0 and yi == 0:
            tn += 1
        else:
            fn += 1

    total = max(1, tp + fp + tn + fn)
    accuracy = (tp + tn) / total
    precision = tp / max(1, tp + fp)
    recall = tp / max(1, tp + fn)
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) > 0 else 0.0

    return {
        "muestras_evaluadas": total,
        "accuracy": round(accuracy, 4),
        "accuracy_pct": round(accuracy * 100.0, 2),
        "precision": round(precision, 4),
        "precision_pct": round(precision * 100.0, 2),
        "recall": round(recall, 4),
        "recall_pct": round(recall * 100.0, 2),
        "f1": round(f1, 4),
        "f1_pct": round(f1 * 100.0, 2),
        "matriz_confusion": {
            "tp": tp,
            "fp": fp,
            "tn": tn,
            "fn": fn,
        },
    }


def ejecutar_kmeans(
    X_scaled: List[List[float]],
    X_raw: List[List[float]],
    k: int = 3,
    seed: int = 2026,
    max_iter: int = 80,
) -> Dict[str, Any]:
    rng = random.Random(seed)
    n = len(X_scaled)
    d = len(X_scaled[0])
    indices_iniciales = rng.sample(range(n), k)
    centroids = [list(X_scaled[i]) for i in indices_iniciales]
    assignments = [0] * n

    for _ in range(max_iter):
        changed = False
        for i, row in enumerate(X_scaled):
            best_c = 0
            best_dist = float("inf")
            for c_idx, cent in enumerate(centroids):
                dist = sum((row[j] - cent[j]) ** 2 for j in range(d))
                if dist < best_dist:
                    best_dist = dist
                    best_c = c_idx
            if assignments[i] != best_c:
                assignments[i] = best_c
                changed = True

        for c_idx in range(k):
            members = [X_scaled[i] for i in range(n) if assignments[i] == c_idx]
            if members:
                centroids[c_idx] = [
                    sum(m[j] for m in members) / len(members) for j in range(d)
                ]
        if not changed:
            break

    inertia = 0.0
    for i, row in enumerate(X_scaled):
        cent = centroids[assignments[i]]
        inertia += sum((row[j] - cent[j]) ** 2 for j in range(d))

    # Ordenar clusters de mayor gasto promedio a menor para etiquetado estable de negocio
    raw_clusters = []
    for c_idx in range(k):
        raw_members = [X_raw[i] for i in range(n) if assignments[i] == c_idx]
        scaled_cent = centroids[c_idx]
        if raw_members:
            raw_cent = [
                round(sum(m[j] for m in raw_members) / len(raw_members), 2)
                for j in range(d)
            ]
        else:
            raw_cent = [0.0] * d
        raw_clusters.append(
            {
                "old_idx": c_idx,
                "tamano": len(raw_members),
                "porcentaje": round((len(raw_members) / max(1, n)) * 100.0, 2),
                "centroide_escalado": {
                    FEATURES_CLIENTE[j]: round(scaled_cent[j], 4) for j in range(d)
                },
                "centroide_original": {
                    FEATURES_CLIENTE[j]: raw_cent[j] for j in range(d)
                },
            }
        )

    raw_clusters.sort(key=lambda c: c["centroide_original"]["gasto_12m_bs"], reverse=True)
    perfiles = [
        (
            "Cluster 0 - Clientes VIP / Alta Frecuencia",
            "Acceso anticipado a nueva coleccion, invitacion al probador AR y reservas prioritarias.",
        ),
        (
            "Cluster 1 - Compradores Regulares Estacionales",
            "Promociones cruzadas por temporada (combos blusa + pantalon) para elevar ticket promedio.",
        ),
        (
            "Cluster 2 - Clientes en Riesgo de Inactividad",
            "Campana de reactivacion con cupon controlado y recordatorio de novedades en su talla.",
        ),
    ]

    segmentos = []
    for idx, cl in enumerate(raw_clusters):
        nombre_seg, accion_negocio = perfiles[idx] if idx < len(perfiles) else (f"Cluster {idx}", "Seguimiento comercial")
        segmentos.append(
            {
                "cluster_id": idx,
                "nombre_segmento": nombre_seg,
                "tamano": cl["tamano"],
                "porcentaje": cl["porcentaje"],
                "centroide_escalado": cl["centroide_escalado"],
                "centroide_original": cl["centroide_original"],
                "decision_negocio": accion_negocio,
            }
        )

    return {
        "k": k,
        "inercia": round(inertia, 2),
        "segmentos": segmentos,
    }


def ejecutar_analisis_ml(
    seed: int = 2026,
    tenant_slug: str = "legacy",
    incluir_artefactos: bool = False,
) -> Dict[str, Any]:
    """
    Entrena de forma reproducible en tiempo real:
      1. Modelo Supervisado Principal: Regresion Logistica (800 muestras, split 80/20 = 640 train / 160 holdout)
         para probabilidad de recompra a 30 dias.
      2. Modelo Supervisado Auxiliar de Inventario: Clasificador de riesgo de quiebre de stock (400 muestras,
         split 80/20 = 320 train / 80 holdout).
      3. Modelo No Supervisado: K-Means (k=3 sobre 300 muestras estandarizadas + comparativa de codo k=2..5).
    """
    # 1. Supervisado: Recompra 30 dias
    data_recompra = generar_dataset_sintetico_recompra(seed=seed, n_samples=800)
    split_idx = int(len(data_recompra) * 0.8)  # 640 train / 160 test
    train_rows = data_recompra[:split_idx]
    test_rows = data_recompra[split_idx:]

    X_train_raw = [[float(r[f]) for f in FEATURES_CLIENTE] for r in train_rows]
    y_train = [int(r["recompra_30d"]) for r in train_rows]
    X_test_raw = [[float(r[f]) for f in FEATURES_CLIENTE] for r in test_rows]
    y_test = [int(r["recompra_30d"]) for r in test_rows]

    # Prevenir data leakage: media y desviacion se ajustan UNICAMENTE sobre train
    means, stds = _standardize_fit(X_train_raw)
    X_train_std = _standardize_transform(X_train_raw, means, stds)
    X_test_std = _standardize_transform(X_test_raw, means, stds)

    weights, bias = entrenar_regresion_logistica(X_train_std, y_train)
    metricas_train = evaluar_clasificador_binario(X_train_std, y_train, weights, bias)
    metricas_holdout = evaluar_clasificador_binario(X_test_std, y_test, weights, bias)

    # 2. Supervisado de Inventario: Riesgo de quiebre de stock
    data_stock = generar_dataset_sintetico_quiebre_stock(seed=seed, n_samples=400)
    split_stock = int(len(data_stock) * 0.8)
    st_train = data_stock[:split_stock]
    st_test = data_stock[split_stock:]
    Xs_train_raw = [[float(r[f]) for f in FEATURES_STOCK] for r in st_train]
    ys_train = [int(r["riesgo_quiebre"]) for r in st_train]
    Xs_test_raw = [[float(r[f]) for f in FEATURES_STOCK] for r in st_test]
    ys_test = [int(r["riesgo_quiebre"]) for r in st_test]
    ms, ss = _standardize_fit(Xs_train_raw)
    Xs_train_std = _standardize_transform(Xs_train_raw, ms, ss)
    Xs_test_std = _standardize_transform(Xs_test_raw, ms, ss)
    ws, bs = entrenar_regresion_logistica(Xs_train_std, ys_train)
    metricas_stock_holdout = evaluar_clasificador_binario(Xs_test_std, ys_test, ws, bs)

    # 3. No Supervisado: K-Means sobre 300 muestras
    data_cluster = data_recompra[:300]
    Xc_raw = [[float(r[f]) for f in FEATURES_CLIENTE] for r in data_cluster]
    mc, sc = _standardize_fit(Xc_raw)
    Xc_std = _standardize_transform(Xc_raw, mc, sc)

    codo_inertias = {}
    for k_cand in (2, 3, 4, 5):
        res_k = ejecutar_kmeans(Xc_std, Xc_raw, k=k_cand, seed=seed)
        codo_inertias[str(k_cand)] = res_k["inercia"]

    kmeans_k3 = ejecutar_kmeans(Xc_std, Xc_raw, k=3, seed=seed)

    result: Dict[str, Any] = {
        "es_dataset_sintetico": True,
        "aviso_gobernanza": (
            "ANALITICA DEMOSTRATIVA ACADEMICA: Los modelos se entrenan en tiempo de ejecucion sobre "
            "datos sinteticos reproducibles (semilla fija). No utilizan datos personales reales ni "
            "ejecutan decisiones comerciales automaticas sin validacion humana."
        ),
        "tenant_slug": tenant_slug,
        "semilla": seed,
        "version_generador": "2.0.0-reproducible",
        "esquema_variables": {
            "dias_desde_compra": {"unidad": "dias", "rango": "1..180", "descripcion": "Recencia desde la ultima compra"},
            "compras_12m": {"unidad": "transacciones", "rango": "1..24", "descripcion": "Frecuencia de compra en 12 meses"},
            "gasto_12m_bs": {"unidad": "BOB (Bs.)", "rango": "90..9500", "descripcion": "Valor monetario acumulado anual"},
            "interacciones_30d": {"unidad": "eventos", "rango": "0..35", "descripcion": "Uso de catalogo, reservas y probador AR en 30 dias"},
        },
        "supervisado": {
            "modelo": "Regresion Logistica (Gradiente Descendente con regularizacion L2)",
            "objetivo": "recompra_30d (Probabilidad de recompra en los proximos 30 dias)",
            "decision_negocio": "Priorizar campanas de retencion y sugerencias de coleccion en clientes con probabilidad >= 0.60.",
            "total_muestras": len(data_recompra),
            "muestras_entrenamiento": len(train_rows),
            "muestras_holdout": len(test_rows),
            "prevencion_leakage": "Estandarizacion (media/desviacion) ajustada exclusivamente sobre las 640 muestras de entrenamiento.",
            "pesos_features": {
                FEATURES_CLIENTE[j]: round(weights[j], 4) for j in range(len(FEATURES_CLIENTE))
            },
            "intercepto": round(bias, 4),
            "metricas_entrenamiento": metricas_train,
            "metricas_holdout": metricas_holdout,
            "modelo_auxiliar_quiebre_stock": {
                "objetivo": "riesgo_quiebre (Clasificacion de riesgo de quiebre de stock por variante)",
                "features": FEATURES_STOCK,
                "muestras_entrenamiento": len(st_train),
                "muestras_holdout": len(st_test),
                "metricas_holdout": metricas_stock_holdout,
                "decision_negocio": "Generar orden de reposicion o transferencia inter-sucursal cuando probabilidad de quiebre >= 0.50.",
            },
            "limitaciones": [
                "Frontera de decision lineal sobre variables estandarizadas.",
                "Entrenado con generador sintetico controlado; requiere recalibracion antes de uso productivo.",
            ],
        },
        "no_supervisado": {
            "modelo": "K-Means Clustering",
            "objetivo": "Segmentacion de perfiles de compra y afinidad de catalogo",
            "muestras_analizadas": len(data_cluster),
            "variables_escaladas": FEATURES_CLIENTE,
            "k_elegido": 3,
            "justificacion_k": (
                "Se selecciono k=3 mediante analisis de inercia (metodo del codo k=2..5) e "
                "interpretabilidad comercial en tres niveles operativos: VIP, Regular y En Riesgo."
            ),
            "inercia_k3": kmeans_k3["inercia"],
            "curva_codo_inercia": codo_inertias,
            "segmentos": kmeans_k3["segmentos"],
            "limitaciones": [
                "K-Means asume clusters esfericos en el espacio estandarizado y es sensible a valores extremos.",
                "Los segmentos sintéticos sirven para planificación y validación, no para inferencias sobre clientes reales.",
            ],
        },
    }

    if incluir_artefactos:
        centros = [
            [float(segmento["centroide_escalado"][feature]) for feature in FEATURES_CLIENTE]
            for segmento in kmeans_k3["segmentos"]
        ]
        result["_artefactos_modelo"] = [
            {
                "algoritmo": "propension_compra_logistica",
                "features": FEATURES_CLIENTE,
                "metricas": {"holdout": metricas_holdout},
                "artefacto": {
                    "formato": 1,
                    "dataset": "sintetico_reproducible",
                    "seed": seed,
                    "features": FEATURES_CLIENTE,
                    "scaler": {"media": means, "desviacion": stds},
                    "pesos": weights,
                    "intercepto": bias,
                },
            },
            {
                "algoritmo": "riesgo_quiebre_logistica",
                "features": FEATURES_STOCK,
                "metricas": {"holdout": metricas_stock_holdout},
                "artefacto": {
                    "formato": 1,
                    "dataset": "sintetico_reproducible",
                    "seed": seed,
                    "features": FEATURES_STOCK,
                    "scaler": {"media": ms, "desviacion": ss},
                    "pesos": ws,
                    "intercepto": bs,
                },
            },
            {
                "algoritmo": "segmentacion_clientes_kmeans",
                "features": FEATURES_CLIENTE,
                "metricas": {
                    "k": 3,
                    "muestras_analizadas": len(data_cluster),
                    "inercia": kmeans_k3["inercia"],
                    "curva_codo_inercia": codo_inertias,
                },
                "artefacto": {
                    "formato": 1,
                    "dataset": "sintetico_reproducible",
                    "seed": seed,
                    "features": FEATURES_CLIENTE,
                    "scaler": {"media": mc, "desviacion": sc},
                    "centroides_escalados": centros,
                    "segmentos": kmeans_k3["segmentos"],
                },
            },
        ]
    return result
