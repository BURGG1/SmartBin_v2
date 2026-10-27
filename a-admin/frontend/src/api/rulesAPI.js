
import BASE_URL from "../config";

const API_BASE = `${BASE_URL}/api/rules`;

async function parseResponse(res, defaultMessage) {
    const json = await res.json().catch(() => ({}));

    if (!res.ok) {
        throw new Error(json.message || defaultMessage);
    }

    if (json.success === false) {
        throw new Error(json.message || defaultMessage);
    }

    return json;
}

export async function getRules() {
    const res = await fetch(API_BASE);
    const json = await parseResponse(res, "Failed to fetch rules");

    return Array.isArray(json) ? json : json.data ?? [];
}

export async function createRule({
    name,
    decs,
    points,
    freq,
    auto,
    streakDays,
    imageFile
}) {
    const formData = new FormData();

    formData.append("name", name);
    formData.append("decs", decs);
    formData.append("points", String(points));
    formData.append("freq", freq);
    formData.append("auto", String(auto ?? false));

    if (freq === "per streak") {
        formData.append("streakDays", String(streakDays ?? ""));
    }

    if (imageFile) {
        formData.append("image", imageFile);
    }

    const res = await fetch(API_BASE, {
        method: "POST",
        body: formData
    });

    const json = await parseResponse(res, "Failed to create rule");
    return json.data ?? json;
}

export async function updateRule(id, {
    name,
    decs,
    points,
    freq,
    auto,
    streakDays,
    imageFile
}) {
    const formData = new FormData();

    if (name !== undefined) formData.append("name", name);
    if (decs !== undefined) formData.append("decs", decs);
    if (points !== undefined) formData.append("points", String(points));
    if (freq !== undefined) formData.append("freq", freq);
    if (auto !== undefined) formData.append("auto", String(auto));

    if (freq === "per streak") {
        formData.append("streakDays", String(streakDays ?? ""));
    } else if (streakDays !== undefined) {
        formData.append("streakDays", String(streakDays));
    }

    if (imageFile) {
        formData.append("image", imageFile);
    }

    const res = await fetch(`${API_BASE}/${id}`, {
        method: "PUT",
        body: formData
    });

    const json = await parseResponse(res, "Failed to update rule");
    return json.data ?? json;
}

export async function deleteRule(id) {
    const res = await fetch(`${API_BASE}/${id}`, {
        method: "DELETE"
    });

    const json = await parseResponse(res, "Failed to delete rule");
    return json;
}
