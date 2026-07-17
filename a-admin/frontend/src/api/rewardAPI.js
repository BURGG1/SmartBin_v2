import BASE_URL from "../config";

const API_BASE = `${BASE_URL}/api/rewards`;

export async function getRewards() {
    const res  = await fetch(API_BASE);
    if (!res.ok) throw new Error("Failed to fetch rewards");
    const json = await res.json();
    return Array.isArray(json) ? json : json.data ?? [];
}

export async function createReward({ name, points, stocks, imageFile }) {
    const formData = new FormData();
    formData.append("name",   name);
    formData.append("points", points);
    formData.append("stocks", stocks);
    if (imageFile) formData.append("image", imageFile);

    const res  = await fetch(API_BASE, { method: "POST", body: formData });
    if (!res.ok) throw new Error("Failed to create reward");
    const json = await res.json();
    return json.data ?? json;
}

export async function updateReward(id, { name, points, stocks, imageFile }) {
    const formData = new FormData();
    if (name !== undefined)   formData.append("name",   name);
    if (points !== undefined) formData.append("points", points);
    if (stocks !== undefined) formData.append("stocks", stocks);
    if (imageFile)            formData.append("image",  imageFile);

    const res  = await fetch(`${API_BASE}/${id}`, { method: "PUT", body: formData });
    if (!res.ok) throw new Error("Failed to update reward");
    const json = await res.json();
    return json.data ?? json;
}

export async function deleteReward(id) {
    const res  = await fetch(`${API_BASE}/${id}`, { method: "DELETE" });
    if (!res.ok) throw new Error("Failed to delete reward");
    return res.json();
}
