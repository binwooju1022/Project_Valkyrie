(function () {
  "use strict";

  const disks = new Map();
  const records = new Map();

  function requireText(value, path) {
    if (typeof value !== "string" || !value.trim()) {
      throw new TypeError(`${path}에는 비어 있지 않은 문자열이 필요합니다.`);
    }
  }

  function registerDisk(disk) {
    requireText(disk?.id, "disk.id");
    requireText(disk?.label, `disk(${disk.id}).label`);

    if (disks.has(disk.id)) {
      throw new Error(`중복 디스크 ID: ${disk.id}`);
    }

    disks.set(disk.id, {
      subtitle: "",
      description: "",
      status: "복구 대기",
      integrity: "--",
      available: true,
      ...disk,
    });
  }

  function registerRecord(record) {
    requireText(record?.id, "record.id");
    requireText(record?.diskId, `record(${record.id}).diskId`);
    requireText(record?.fileName, `record(${record.id}).fileName`);

    if (records.has(record.id)) {
      throw new Error(`중복 기록 ID: ${record.id}`);
    }

    records.set(record.id, {
      type: "기록 데이터",
      source: "출처 불명",
      integrity: "--",
      status: "부분 복구",
      summary: "",
      objective: [],
      analysis: [],
      recommendation: "",
      storySource: "인지 보완 자료",
      reliability: "신뢰도 불명",
      defaultVisual: {
        background: "배경 미지정",
        character: "인물 미지정",
        framing: "구도 미지정",
      },
      story: [],
      completion: {},
      ...record,
    });
  }

  function getDisks() {
    return [...disks.values()];
  }

  function getDisk(id) {
    return disks.get(id) || null;
  }

  function getRecord(id) {
    return records.get(id) || null;
  }

  function getRecordByDisplayId(id) {
    return [...records.values()].find(record=>(record.displayId || record.id)===id) || null;
  }

  function getRecordsByDisk(diskId) {
    return [...records.values()].filter((record) => record.diskId === diskId);
  }

  function validate() {
    const errors = [];

    records.forEach((record) => {
      if (!disks.has(record.diskId)) {
        errors.push(`${record.id}: 존재하지 않는 디스크 ${record.diskId}`);
      }
      if (!Array.isArray(record.objective)) {
        errors.push(`${record.id}.objective는 배열이어야 합니다.`);
      }
      if (!Array.isArray(record.analysis)) {
        errors.push(`${record.id}.analysis는 배열이어야 합니다.`);
      }
      if (!Array.isArray(record.story)) {
        errors.push(`${record.id}.story는 배열이어야 합니다.`);
      }
    });

    if (errors.length) {
      throw new Error(`기록 데이터 검증 실패\n${errors.join("\n")}`);
    }

    return {
      diskCount: disks.size,
      recordCount: records.size,
    };
  }

  window.RustedPrayerArchive = {
    registerDisk,
    registerRecord,
    getDisks,
    getDisk,
    getRecord,
    getRecordByDisplayId,
    getRecordsByDisk,
    validate,
  };
})();
