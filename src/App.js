import React, { useState, useEffect, useCallback, useRef } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, setDoc, onSnapshot, collection, addDoc, updateDoc, query, where, getDocs, deleteDoc } from 'firebase/firestore';

// Tone.js CDN 로드
// 이 스크립트는 React 컴포넌트 내부가 아닌 HTML 파일의 <head>에 위치해야 하지만,
// 개발 환경에서 편의상 여기에 포함하여 Tone 객체를 사용할 수 있도록 합니다.
// 실제 배포 시에는 index.html <head>에 <script src="https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js"></script> 추가를 권장합니다.
// Tone.js는 전역 Tone 객체를 노출합니다.
// eslint-disable-next-line
import * as Tone from 'tone';


// Firebase 설정 (전역 변수로 제공됨)
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

// 캐릭터 초기 능력치 및 레벨업 공식
const BASE_HEALTH = 100;
const BASE_INTELLIGENCE = 10;
const BASE_STRENGTH = 10;
const BASE_GOLD = 0;
const BASE_LEVEL = 1;
const BASE_EXP = 0;
const EXP_PER_LEVEL = 100; // 레벨업에 필요한 기본 경험치 (레벨에 따라 증가 가능)

// 아이템 데이터베이스 (상점 카테고리 추가)
const ITEM_DATABASE = [
  // 잡화점 (General Store) 아이템
  { id: 'item_4', name: '체력 포션', type: 'consumable', value: 5, stats: { health: 10 }, description: '체력을 회복시켜준다.', shopCategory: 'general' },
  { id: 'item_5', name: '마나 포션', type: 'consumable', value: 5, stats: { intelligence: 5 }, description: '마나를 회복시켜준다.', shopCategory: 'general' },
  { id: 'item_6', name: '골드 주머니', type: 'misc', value: 50, stats: {}, description: '골드가 들어있는 주머니.', shopCategory: 'general' },
  // 대장간 (Blacksmith) 아이템
  { id: 'item_1', name: '낡은 검', type: 'weapon', value: 10, stats: { strength: 2 }, description: '오래된 검이지만 쓸만하다.', shopCategory: 'blacksmith' },
  { id: 'item_7', name: '강철 검', type: 'weapon', value: 50, stats: { strength: 8 }, description: '단단한 강철로 만들어진 검.', shopCategory: 'blacksmith' },
  { id: 'item_2', name: '나무 방패', type: 'armor', value: 15, stats: { health: 5 }, description: '간단한 나무 방패.', shopCategory: 'blacksmith' },
  // 의상실 (Tailor) 아이템
  { id: 'item_3', name: '초보자 로브', type: 'armor', value: 20, stats: { intelligence: 3 }, description: '마법 초보자를 위한 로브.', shopCategory: 'tailor' },
  { id: 'item_8', name: '가죽 갑옷', type: 'armor', value: 40, stats: { health: 15, strength: 2 }, description: '가볍고 튼튼한 가죽 갑옷.', shopCategory: 'tailor' },
  { id: 'item_9', name: '나무 헬멧', type: 'head', value: 10, stats: { defense: 3 }, description: '머리를 보호하는 나무 헬멧.', shopCategory: 'tailor' },
];

// 능력치 계산 함수
const calculateDerivedStats = (character) => {
  let { health, intelligence, strength, level } = character;
  let equippedHealth = 0;
  let equippedIntelligence = 0;
  let equippedStrength = 0;
  let equippedDefense = 0;

  // 장착 아이템의 능력치 합산
  if (character.equippedItems) {
    for (const slot in character.equippedItems) {
      const item = character.equippedItems[slot];
      if (item && item.stats) {
        equippedHealth += item.stats.health || 0;
        equippedIntelligence += item.stats.intelligence || 0;
        equippedStrength += item.stats.strength || 0;
        equippedDefense += item.stats.defense || 0;
      }
    }
  }

  // 기본 능력치 + 장착 아이템 능력치
  health += equippedHealth;
  intelligence += equippedIntelligence;
  strength += equippedStrength;

  // 플로우차트의 공식을 기반으로 단순화하여 적용
  const maxHealth = BASE_HEALTH + (health * 2) + (level * 10);
  const maxMana = (intelligence * 5) + (level * 5); // MP는 현재 사용되지 않지만 추가
  const attack = strength * 1.5 + level * 2;
  const defense = (health * 0.8) + (level * 1) + equippedDefense; // 방어력에 장착 아이템 방어력 추가
  return { maxHealth, maxMana, attack, defense };
};

// 아바타 파츠 데이터 (간단한 SVG로 표현)
const AVATAR_HAIR_STYLES = [
  { id: 'none', name: '없음', svg: '' },
  {
    id: 'short_hair',
    name: '짧은 머리',
    svg: `<rect x="24" y="10" width="16" height="8" fill="#8B4513" />` // 갈색
  },
  {
    id: 'long_hair',
    name: '긴 머리',
    svg: `<path d="M24 10 Q20 15 20 20 L20 30 Q28 35 44 30 L44 20 Q44 15 40 10 Z" fill="#4B0082" />` // 남색
  },
];

const AVATAR_OUTFITS = [
  { id: 'none', name: '없음', svg: '' },
  {
    id: 'tshirt',
    name: '티셔츠',
    svg: `<rect x="20" y="32" width="24" height="10" fill="#3498DB" />` // 파란색
  },
  {
    id: 'robe',
    name: '로브',
    svg: `<rect x="18" y="32" width="28" height="20" fill="#9B59B6" />` // 보라색
  },
];

const AVATAR_WEAPONS = [
  { id: 'none', name: '없음', svg: '' },
  {
    id: 'sword',
    name: '검',
    svg: `<rect x="45" y="35" width="5" height="15" fill="#A9A9A9" /><rect x="47" y="30" width="1" height="5" fill="#A9A9A9" />` // 회색 검
  },
  {
    id: 'staff',
    name: '지팡이',
    svg: `<rect x="15" y="25" width="3" height="25" fill="#8B4513" /><circle cx="16.5" cy="23" r="3" fill="#FFD700" />` // 갈색 지팡이와 금색 구슬
  },
];

// 도트 캐릭터 아바타 SVG 컴포넌트 (baseImageSrc 제거)
const PixelAvatar = ({ hairId, outfitId, weaponId }) => {
  const getPartSvg = (partsArray, id) => {
    const part = partsArray.find(p => p.id === id);
    return part ? part.svg : '';
  };

  return (
    <div className="relative w-full h-full">
      {/* 아바타 뼈대 이미지를 제거하고, SVG 파츠만 렌더링 */}
      {/* 기본 얼굴 형태 (간단한 원이나 사각형) */}
      <svg className="absolute top-0 left-0 w-full h-full" viewBox="0 0 64 64">
        {/* 기본 얼굴 형태 (피부색) */}
        <circle cx="32" cy="24" r="12" fill="#F0C6B0" />
        {/* 눈 (간단한 점) */}
        <circle cx="28" cy="22" r="2" fill="#4A4A4A" />
        <circle cx="36" cy="22" r="2" fill="#4A4A4A" />
        {/* 입 (간단한 선) */}
        <rect x="30" y="28" width="4" height="2" fill="#8B4513" />
      </svg>

      {/* 머리 스타일 SVG 오버레이 */}
      {hairId && (
        <svg className="absolute top-0 left-0 w-full h-full" viewBox="0 0 64 64" dangerouslySetInnerHTML={{ __html: getPartSvg(AVATAR_HAIR_STYLES, hairId) }} />
      )}
      {/* 옷 SVG 오버레이 */}
      {outfitId && (
        <svg className="absolute top-0 left-0 w-full h-full" viewBox="0 0 64 64" dangerouslySetInnerHTML={{ __html: getPartSvg(AVATAR_OUTFITS, outfitId) }} />
      )}
      {/* 무기 SVG 오버레이 */}
      {weaponId && (
        <svg className="absolute top-0 left-0 w-full h-full" viewBox="0 0 64 64" dangerouslySetInnerHTML={{ __html: getPartSvg(AVATAR_WEAPONS, weaponId) }} />
      )}
    </div>
  );
};

// 아바타 꾸미기 화면 컴포넌트
const AvatarCustomizationScreen = ({ character, updateCharacterPart, onClose }) => {
  // 아바타 뼈대 이미지를 더 이상 사용하지 않으므로 avatarBaseImageUrl 변수 제거

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-4 sm:p-8 font-inter flex flex-col items-center justify-center">
      <div className="bg-gray-800 p-8 rounded-2xl shadow-xl border border-gray-700 max-w-lg w-full text-center">
        <h2 className="text-3xl font-bold mb-6 text-pink-400 flex items-center justify-center">
          <svg className="w-8 h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
          아바타 꾸미기
        </h2>

        {/* 현재 아바타 미리보기 */}
        <div className="flex justify-center mb-8">
          <div className={`w-32 h-32 flex items-center justify-center border-4 border-gray-600 overflow-hidden`}>
            <PixelAvatar
              // baseImageSrc prop 제거
              hairId={character.hairId}
              outfitId={character.outfitId}
              weaponId={character.weaponId}
            />
          </div>
        </div>

        {/* 머리 스타일 선택 */}
        <div className="mb-6">
          <h3 className="text-xl font-semibold mb-3 text-yellow-300">머리 스타일</h3>
          <div className="flex flex-wrap gap-3 justify-center">
            {AVATAR_HAIR_STYLES.map((style) => (
              <button
                key={style.id}
                onClick={() => updateCharacterPart('hairId', style.id)}
                className={`flex flex-col items-center p-3 rounded-lg border-2 ${character.hairId === style.id ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-600'} hover:border-blue-400 transition duration-200`}
              >
                <div className="w-12 h-12 flex items-center justify-center">
                  {style.svg && <svg viewBox="0 0 64 64" dangerouslySetInnerHTML={{ __html: style.svg }} />}
                  {!style.svg && <span className="text-gray-400 text-xs">없음</span>}
                </div>
                <span className="text-sm text-gray-300 mt-1">{style.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 옷 선택 */}
        <div className="mb-6">
          <h3 className="text-xl font-semibold mb-3 text-green-300">옷</h3>
          <div className="flex flex-wrap gap-3 justify-center">
            {AVATAR_OUTFITS.map((outfit) => (
              <button
                key={outfit.id}
                onClick={() => updateCharacterPart('outfitId', outfit.id)}
                className={`flex flex-col items-center p-3 rounded-lg border-2 ${character.outfitId === outfit.id ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-600'} hover:border-blue-400 transition duration-200`}
              >
                <div className="w-12 h-12 flex items-center justify-center">
                  {outfit.svg && <svg viewBox="0 0 64 64" dangerouslySetInnerHTML={{ __html: outfit.svg }} />}
                  {!outfit.svg && <span className="text-gray-400 text-xs">없음</span>}
                </div>
                <span className="text-sm text-gray-300 mt-1">{outfit.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 무기 선택 */}
        <div className="mb-8">
          <h3 className="text-xl font-semibold mb-3 text-red-300">무기</h3>
          <div className="flex flex-wrap gap-3 justify-center">
            {AVATAR_WEAPONS.map((weapon) => (
              <button
                key={weapon.id}
                onClick={() => updateCharacterPart('weaponId', weapon.id)}
                className={`flex flex-col items-center p-3 rounded-lg border-2 ${character.weaponId === weapon.id ? 'border-blue-500 ring-2 ring-blue-500' : 'border-gray-600'} hover:border-blue-400 transition duration-200`}
              >
                <div className="w-12 h-12 flex items-center justify-center">
                  {weapon.svg && <svg viewBox="0 0 64 64" dangerouslySetInnerHTML={{ __html: weapon.svg }} />}
                  {!weapon.svg && <span className="text-gray-400 text-xs">없음</span>}
                </div>
                <span className="text-sm text-gray-300 mt-1">{weapon.name}</span>
              </button>
            ))}
          </div>
        </div>

        {/* 뒤로 가기 버튼 */}
        <button
          onClick={onClose}
          className="w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white py-3 rounded-lg font-bold text-lg shadow-md hover:from-gray-700 hover:to-gray-800 transition duration-300 transform hover:scale-105"
        >
          뒤로 가기
        </button>
      </div>
    </div>
  );
};

// --- 새로운 화면 컴포넌트들 ---

const ItemsScreen = ({ character, onBack, sellItem, equipItem, unequipItem }) => {
  const [activeTab, setActiveTab] = useState('inventory'); // 'inventory' 또는 'compendium'
  const [activeItemTab, setActiveItemTab] = useState('all'); // 'all', 'consumable', 'equipment', 'outfit'
  const [sortBy, setSortBy] = useState('name'); // 정렬 기준
  const [sortOrder, setSortOrder] = useState('asc'); // 정렬 순서

  // 필터링 및 정렬된 인벤토리
  const filteredAndSortedInventory = [...character.inventory]
    .filter(item => {
      if (activeItemTab === 'all') return true;
      if (activeItemTab === 'consumable') return item.type === 'consumable' || item.type === 'misc';
      if (activeItemTab === 'equipment') return item.type === 'weapon' || item.type === 'armor';
      if (activeItemTab === 'outfit') return item.type === 'head'; // 의상 카테고리에 머리 아이템 포함
      return true;
    })
    .sort((a, b) => {
      let compareA, compareB;
      if (sortBy === 'name') {
        compareA = a.name.toLowerCase();
        compareB = b.name.toLowerCase();
      } else if (sortBy === 'type') {
        compareA = a.type.toLowerCase();
        compareB = b.type.toLowerCase();
      } else if (sortBy === 'value') {
        compareA = a.value;
        compareB = b.value;
      }

      if (compareA < compareB) return sortOrder === 'asc' ? -1 : 1;
      if (compareA > compareB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });

  // 아이템이 현재 장착되어 있는지 확인하는 헬퍼 함수
  const isItemCurrentlyEquipped = (item) => {
    if (!item || !item.type || !character.equippedItems) return false;
    const equippedInSlot = character.equippedItems[item.type];
    return equippedInSlot && equippedInSlot.uniqueId === item.uniqueId;
  };

  // 아이템 도감: 소유한 아이템 ID Set 생성
  const ownedItemIds = new Set(character.inventory.map(item => item.id));
  const totalUniqueItems = new Set(ITEM_DATABASE.map(item => item.id)).size;
  const ownedPercentage = totalUniqueItems > 0 ? ((ownedItemIds.size / totalUniqueItems) * 100).toFixed(1) : 0;


  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-4 sm:p-8 font-inter flex flex-col items-center">
      <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700 max-w-4xl w-full text-center mt-8">
        <h2 className="text-3xl font-bold mb-6 text-orange-400 flex items-center justify-center">
          <svg className="w-8 h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10m-4-2h8m-4 2v4"></path></svg>
          아이템
        </h2>

        {/* 메인 탭 네비게이션 (인벤토리 / 아이템 도감) */}
        <div className="flex justify-center mb-6 border-b border-gray-700">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-6 py-3 text-lg font-semibold rounded-t-lg transition duration-200 ${activeTab === 'inventory' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
          >
            인벤토리
          </button>
          <button
            onClick={() => setActiveTab('compendium')}
            className={`px-6 py-3 text-lg font-semibold rounded-t-lg transition duration-200 ${activeTab === 'compendium' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
          >
            아이템 도감
          </button>
        </div>

        {activeTab === 'inventory' && (
          <div>
            <h3 className="text-xl font-semibold mb-4 text-gray-300">내 인벤토리</h3>
            {/* 인벤토리 서브 탭 (소모품 / 장비 / 의상) */}
            <div className="flex justify-center mb-4 border-b border-gray-700">
              <button
                onClick={() => setActiveItemTab('all')}
                className={`px-4 py-2 text-md font-semibold rounded-t-lg transition duration-200 ${activeItemTab === 'all' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
              >
                전체
              </button>
              <button
                onClick={() => setActiveItemTab('consumable')}
                className={`px-4 py-2 text-md font-semibold rounded-t-lg transition duration-200 ${activeItemTab === 'consumable' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
              >
                소모품
              </button>
              <button
                onClick={() => setActiveItemTab('equipment')}
                className={`px-4 py-2 text-md font-semibold rounded-t-lg transition duration-200 ${activeItemTab === 'equipment' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
              >
                장비
              </button>
              <button
                onClick={() => setActiveItemTab('outfit')}
                className={`px-4 py-2 text-md font-semibold rounded-t-lg transition duration-200 ${activeItemTab === 'outfit' ? 'bg-indigo-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
              >
                의상
              </button>
            </div>

            <div className="flex justify-end items-center mb-4 gap-2">
              <span className="text-gray-400">정렬:</span>
              <select
                className="p-2 rounded-lg bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value)}
              >
                <option value="name">이름</option>
                <option value="type">유형</option>
                <option value="value">가치</option>
              </select>
              <button
                onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                className="p-2 rounded-lg bg-gray-700 text-white border border-gray-600 hover:bg-gray-600"
              >
                {sortOrder === 'asc' ? '▲' : '▼'}
              </button>
            </div>

            {filteredAndSortedInventory.length === 0 ? (
              <p className="text-gray-400 py-4">이 카테고리에는 아이템이 비어있습니다.</p>
            ) : (
              <ul className="space-y-3">
                {filteredAndSortedInventory.map((item, index) => (
                  <li key={item.uniqueId || item.id + index} className="bg-gray-700 p-4 rounded-lg text-left flex flex-col sm:flex-row justify-between items-center">
                    <div className="flex-grow mb-2 sm:mb-0">
                      <p className="font-medium text-lg text-white">
                        {item.name} {isItemCurrentlyEquipped(item) && <span className="text-blue-400 text-sm">(장착됨)</span>}
                      </p>
                      <p className="text-sm text-gray-400">유형: {item.type === 'weapon' ? '무기' : item.type === 'armor' ? '방어구' : item.type === 'consumable' ? '소모품' : item.type === 'head' ? '머리' : '기타'}</p>
                      <p className="text-sm text-gray-400">가치: {item.value} 골드</p>
                      {item.stats && Object.keys(item.stats).length > 0 && (
                        <p className="text-sm text-gray-400">
                          능력치: {Object.entries(item.stats).map(([stat, val]) => `${stat}:+${val}`).join(', ')}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                    </div>
                    <div className="flex space-x-2 mt-2 sm:mt-0">
                      {['weapon', 'armor', 'head'].includes(item.type) && (
                        isItemCurrentlyEquipped(item) ? (
                          <button
                            onClick={() => unequipItem(item)}
                            className="bg-red-600 text-white px-3 py-1 rounded-md text-sm hover:bg-red-700 transition duration-200"
                          >
                            장착 해제
                          </button>
                        ) : (
                          <button
                            onClick={() => equipItem(item)}
                            className="bg-blue-600 text-white px-3 py-1 rounded-md text-sm hover:bg-blue-700 transition duration-200"
                          >
                            장착
                          </button>
                        )
                      )}
                      <button
                        onClick={() => sellItem(item)}
                        className="bg-yellow-600 text-white px-3 py-1 rounded-md text-sm hover:bg-yellow-700 transition duration-200"
                      >
                        판매
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {activeTab === 'compendium' && (
          <div>
            <h3 className="text-xl font-semibold mb-4 text-gray-300">아이템 도감</h3>
            <p className="text-gray-400 mb-4">
              보유 아이템: {ownedItemIds.size} / {totalUniqueItems} ({ownedPercentage}%)
            </p>
            <ul className="space-y-3">
              {ITEM_DATABASE.map((item) => (
                <li
                  key={item.id}
                  className={`p-4 rounded-lg text-left ${ownedItemIds.has(item.id) ? 'bg-blue-900 border border-blue-400' : 'bg-gray-700 border border-gray-600'}`}
                >
                  <p className="font-medium text-lg text-white">{item.name} {ownedItemIds.has(item.id) && <span className="text-blue-200 text-sm">(보유)</span>}</p>
                  <p className="text-sm text-gray-400">유형: {item.type === 'weapon' ? '무기' : item.type === 'armor' ? '방어구' : item.type === 'consumable' ? '소모품' : item.type === 'head' ? '머리' : '기타'}</p>
                  <p className="text-sm text-gray-400">가치: {item.value} 골드</p>
                  {item.stats && Object.keys(item.stats).length > 0 && (
                    <p className="text-sm text-gray-400">
                      능력치: {Object.entries(item.stats).map(([stat, val]) => `${stat}:+${val}`).join(', ')}
                    </p>
                  )}
                  <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                </div>
              </li>
            ))}
          </ul>
        )}

        <button
          onClick={onBack}
          className="mt-8 w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white py-3 rounded-lg font-bold text-lg shadow-md hover:from-gray-700 hover:to-gray-800 transition duration-300 transform hover:scale-105"
        >
          뒤로 가기
        </button>
      </div>
    </div>

    const ShopScreen = ({ character, onBack, buyItem }) => { // character와 buyItem prop 추가
      const [activeShopTab, setActiveShopTab] = useState('general'); // 'general', 'blacksmith', 'tailor'

      const getItemsForShop = (category) => {
        return ITEM_DATABASE.filter(item => item.shopCategory === category);
      };

      return (
        <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-4 sm:p-8 font-inter flex flex-col items-center">
          <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700 max-w-4xl w-full text-center mt-8">
            <h2 className="text-3xl font-bold mb-6 text-yellow-400 flex items-center justify-center">
              <svg className="w-8 h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
              상점가
            </h2>

            {/* 상점 탭 네비게이션 */}
            <div className="flex justify-center mb-6 border-b border-gray-700">
              <button
                onClick={() => setActiveShopTab('general')}
                className={`px-6 py-3 text-lg font-semibold rounded-t-lg transition duration-200 ${activeShopTab === 'general' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
              >
                잡화점
              </button>
              <button
                onClick={() => setActiveShopTab('blacksmith')}
                className={`px-6 py-3 text-lg font-semibold rounded-t-lg transition duration-200 ${activeShopTab === 'blacksmith' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
              >
                대장간
              </button>
              <button
                onClick={() => setActiveShopTab('tailor')}
                className={`px-6 py-3 text-lg font-semibold rounded-t-lg transition duration-200 ${activeShopTab === 'tailor' ? 'bg-blue-600 text-white' : 'text-gray-400 hover:bg-gray-700'}`}
              >
                의상실
              </button>
            </div>

            {/* 현재 상점의 아이템 목록 */}
            <div className="w-full">
              <h3 className="text-xl font-semibold mb-4 text-gray-300">
                {activeShopTab === 'general' && '잡화점 아이템'}
                {activeShopTab === 'blacksmith' && '대장간 아이템'}
                {activeShopTab === 'tailor' && '의상실 아이템'}
              </h3>
              <ul className="space-y-3">
                {getItemsForShop(activeShopTab).length === 0 ? (
                  <p className="text-gray-400 py-4">이 상점에는 판매할 아이템이 없습니다.</p>
                ) : (
                  getItemsForShop(activeShopTab).map((item) => (
                    <li key={item.id} className="bg-gray-700 p-4 rounded-lg text-left flex flex-col sm:flex-row justify-between items-center">
                      <div className="flex-grow mb-2 sm:mb-0">
                        <p className="font-medium text-lg text-white">{item.name}</p>
                        <p className="text-sm text-gray-400">유형: {item.type === 'weapon' ? '무기' : item.type === 'armor' ? '방어구' : item.type === 'consumable' ? '소모품' : item.type === 'head' ? '머리' : '기타'}</p>
                        <p className="text-sm text-gray-400">가격: {item.value} 골드</p>
                        {item.stats && Object.keys(item.stats).length > 0 && (
                          <p className="text-sm text-gray-400">
                            능력치: {Object.entries(item.stats).map(([stat, val]) => `${stat}:+${val}`).join(', ')}
                          </p>
                        )}
                        <p className="text-xs text-gray-500 mt-1">{item.description}</p>
                      </div>
                      <div className="flex space-x-2 mt-2 sm:mt-0">
                        <button
                          onClick={() => buyItem(item, 1)}
                          className="bg-blue-600 text-white px-3 py-1 rounded-md text-sm hover:bg-blue-700 transition duration-200"
                        >
                          1개 구매
                        </button>
                        <button
                          onClick={() => buyItem(item, 10)}
                          className="bg-green-600 text-white px-3 py-1 rounded-md text-sm hover:bg-green-700 transition duration-200"
                        >
                          10개 구매
                        </button>
                      </div>
                    </li>
                  ))
                )}
              </ul>
            </div>

            <button
              onClick={onBack}
              className="mt-8 w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white py-3 rounded-lg font-bold text-lg shadow-md hover:from-gray-700 hover:to-gray-800 transition duration-300 transform hover:scale-105"
            >
              뒤로 가기
            </button>
          </div>
        </div>

        const GuildScreen = ({ onBack }) => (
          <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-4 sm:p-8 font-inter flex flex-col items-center">
            <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700 max-w-2xl w-full text-center mt-8">
              <h2 className="text-3xl font-bold mb-6 text-blue-400 flex items-center justify-center">
                <svg className="w-8 h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h2a2 2 0 002-2V7a2 2 0 00-2-2h-2m-4 14v-2m4 2v-2m-10 2H4A2 2 0 012 18V7a2 2 0 012-2h2m4 14V7m0 10h4m-4 4H9.5M4 7h16M7 7h10"></path></svg>
                길드
              </h2>
              <p className="text-gray-300 text-lg">길드 활동을 통해 다른 사용자와 협력하고 목표를 달성하세요!</p>
              <button
                onClick={onBack}
                className="mt-8 w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white py-3 rounded-lg font-bold text-lg shadow-md hover:from-gray-700 hover:to-gray-800 transition duration-300 transform hover:scale-105"
              >
                뒤로 가기
              </button>
            </div>
          </div>
        );

        const AdventureScreen = ({ onBack }) => {
          const [timerSeconds, setTimerSeconds] = useState(0);
          const [timerMinutes, setTimerMinutes] = useState(0);
          const [isRunning, setIsRunning] = useState(false);
          const [bgmPlaying, setBgmPlaying] = useState(false);
          const timerRef = useRef(null);
          const synthRef = useRef(null); // Tone.Synth 인스턴스를 저장할 ref

          // BGM 초기화 및 재생/정지 로직
          useEffect(() => {
            // Tone.js Synth 초기화 (컴포넌트 마운트 시 한 번만)
            if (!synthRef.current) {
              synthRef.current = new Tone.PolySynth(Tone.Synth, {
                oscillator: {
                  type: "sine"
                },
                envelope: {
                  attack: 0.005,
                  decay: 0.1,
                  sustain: 0.3,
                  release: 1
                }
              }).toDestination();
              synthRef.current.volume.value = -15; // 볼륨 조절
            }

            // 컴포넌트 언마운트 시 BGM 정지 및 리소스 해제
            return () => {
              if (synthRef.current) {
                synthRef.current.releaseAll();
                synthRef.current.dispose();
                synthRef.current = null;
              }
              if (timerRef.current) {
                clearInterval(timerRef.current);
              }
            };
          }, []);

          // 타이머 로직
          useEffect(() => {
            if (isRunning) {
              timerRef.current = setInterval(() => {
                setTimerSeconds(prevSeconds => {
                  if (prevSeconds === 59) {
                    setTimerMinutes(prevMinutes => prevMinutes + 1);
                    return 0;
                  }
                  return prevSeconds + 1;
                });
              }, 1000);
            } else {
              clearInterval(timerRef.current);
            }
            return () => clearInterval(timerRef.current);
          }, [isRunning]);

          const startTimer = () => {
            setIsRunning(true);
          };

          const stopTimer = () => {
            setIsRunning(false);
          };

          const resetTimer = () => {
            setIsRunning(false);
            setTimerSeconds(0);
            setTimerMinutes(0);
          };

          const playBGM = async () => {
            if (!bgmPlaying) {
              // 오디오 컨텍스트 시작 (사용자 제스처 필요)
              if (Tone.context.state !== 'running') {
                await Tone.start();
                console.log('Tone.js AudioContext started.');
              }

              // 간단한 코드 진행 (C-G-Am-F)
              const notes = ["C4", "G3", "A3", "F3"];
              let noteIndex = 0;

              // Tone.Loop를 사용하여 반복 재생
              synthRef.current.loop = new Tone.Loop(time => {
                const note = notes[noteIndex % notes.length];
                synthRef.current.triggerAttackRelease(note, "8n", time);
                noteIndex++;
              }, "4n").start(0);

              Tone.Transport.start(); // Tone.js 트랜스포트 시작
              setBgmPlaying(true);
              console.log('BGM 재생 시작');
            }
          };

          const stopBGM = () => {
            if (bgmPlaying) {
              Tone.Transport.stop(); // Tone.js 트랜스포트 정지
              synthRef.current.releaseAll(); // 모든 음정 해제
              setBgmPlaying(false);
              console.log('BGM 재생 정지');
            }
          };

          const formatTime = (minutes, seconds) => {
            const formattedMinutes = String(minutes).padStart(2, '0');
            const formattedSeconds = String(seconds).padStart(2, '0');
            return `${formattedMinutes}:${formattedSeconds}`;
          };

          return (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-4 sm:p-8 font-inter flex flex-col items-center">
              <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700 max-w-2xl w-full text-center mt-8">
                <h2 className="text-3xl font-bold mb-6 text-green-400 flex items-center justify-center">
                  <svg className="w-8 h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.747 0-3.332.477-4.5 1.253"></path></svg>
                  모험 시작
                </h2>
                <p className="text-gray-300 text-lg mb-6">새로운 모험을 시작하고 퀘스트를 완료하세요!</p>

                {/* 타이머 섹션 */}
                <div className="bg-gray-700 p-4 rounded-lg mb-6">
                  <h3 className="text-2xl font-bold text-yellow-300 mb-4">타이머</h3>
                  <div className="text-5xl font-mono mb-4 text-white">
                    {formatTime(timerMinutes, timerSeconds)}
                  </div>
                  <div className="flex justify-center space-x-4">
                    <button
                      onClick={startTimer}
                      disabled={isRunning}
                      className="bg-green-600 text-white px-5 py-2 rounded-lg font-bold text-lg shadow-md hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition duration-300"
                    >
                      시작
                    </button>
                    <button
                      onClick={stopTimer}
                      disabled={!isRunning && (timerSeconds === 0 && timerMinutes === 0)}
                      className="bg-red-600 text-white px-5 py-2 rounded-lg font-bold text-lg shadow-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition duration-300"
                    >
                      정지
                    </button>
                    <button
                      onClick={resetTimer}
                      className="bg-gray-500 text-white px-5 py-2 rounded-lg font-bold text-lg shadow-md hover:bg-gray-600 transition duration-300"
                    >
                      재설정
                    </button>
                  </div>
                </div>

                {/* BGM 섹션 */}
                <div className="bg-gray-700 p-4 rounded-lg mb-6">
                  <h3 className="text-2xl font-bold text-purple-300 mb-4">BGM</h3>
                  <div className="flex justify-center space-x-4">
                    <button
                      onClick={playBGM}
                      disabled={bgmPlaying}
                      className="bg-blue-600 text-white px-5 py-2 rounded-lg font-bold text-lg shadow-md hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition duration-300"
                    >
                      BGM 재생
                    </button>
                    <button
                      onClick={stopBGM}
                      disabled={!bgmPlaying}
                      className="bg-red-600 text-white px-5 py-2 rounded-lg font-bold text-lg shadow-md hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition duration-300"
                    >
                      BGM 정지
                    </button>
                  </div>
                  <p className="text-gray-400 text-sm mt-3">
                    *BGM은 간단한 코드 진행으로 구성되어 있습니다.
                  </p>
                </div>

                <button
                  onClick={onBack}
                  className="mt-8 w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white py-3 rounded-lg font-bold text-lg shadow-md hover:from-gray-700 hover:to-gray-800 transition duration-300 transform hover:scale-105"
                >
                  뒤로 가기
                </button>
              </div>
            </div>
          );

          // --- 기타 화면의 서브 컴포넌트들 ---

          const StatisticsSection = ({ onBack }) => (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-4 sm:p-8 font-inter flex flex-col items-center">
              <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700 max-w-2xl w-full text-center mt-8">
                <h2 className="text-3xl font-bold mb-6 text-cyan-400 flex items-center justify-center">
                  <svg className="w-8 h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z"></path></svg>
                  통계
                </h2>
                <p className="text-gray-300 text-lg">여기에 사용자 통계 정보가 표시됩니다.</p>
                <button
                  onClick={onBack}
                  className="mt-8 w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white py-3 rounded-lg font-bold text-lg shadow-md hover:from-gray-700 hover:to-gray-800 transition duration-300 transform hover:scale-105"
                >
                  뒤로 가기
                </button>
              </div>
            </div>
          );

          const RankingSection = ({ onBack }) => (
            <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-4 sm:p-8 font-inter flex flex-col items-center">
              <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700 max-w-2xl w-full text-center mt-8">
                <h2 className="text-3xl font-bold mb-6 text-yellow-400 flex items-center justify-center">
                  <svg className="w-8 h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.329 1.176l1.519 4.674c.3.921-.755 1.688-1.539 1.175l-4.915-3.181a1 1 0 00-1.176 0l-4.915 3.181c-.784.513-1.838-.254-1.539-1.175l1.519-4.674a1 1 0 00-.329-1.176l-3.976-2.888c-.784-.57-.381-1.81.588-1.81h4.915a1 1 0 00.95-.69l1.519-4.674z"></path></svg>
                  랭킹
                </h2>
                <p className="text-gray-300 text-lg">여기에 사용자 랭킹 정보가 표시됩니다.</p>
                <button
                  onClick={onBack}
                  className="mt-8 w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white py-3 rounded-lg font-bold text-lg shadow-md hover:from-gray-700 hover:to-gray-800 transition duration-300 transform hover:scale-105"
                >
                  뒤로 가기
                </button>
              </div>
            </div>
          );

          const DiarySection = ({ userId, db, onBack }) => {
            const [currentMonth, setCurrentMonth] = useState(new Date());
            const [selectedDate, setSelectedDate] = useState(new Date());
            const [memoContent, setMemoContent] = useState('');
            const [memoDocId, setMemoDocId] = useState(null); // Firestore 문서 ID
            const memoSaveTimeoutRef = useRef(null); // 디바운싱을 위한 ref

            const formatDateForFirestore = (date) => {
              const year = date.getFullYear();
              const month = String(date.getMonth() + 1).padStart(2, '0');
              const day = String(date.getDate()).padStart(2, '0');
              return `${year}-${month}-${day}`;
            };

            const loadMemo = useCallback(async (date) => {
              if (!userId || !db) return;
              const formattedDate = formatDateForFirestore(date);
              const diaryCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/diaryEntries`);
              const q = query(diaryCollectionRef, where("date", "==", formattedDate));
              const querySnapshot = await getDocs(q);

              if (!querySnapshot.empty) {
                const doc = querySnapshot.docs[0];
                setMemoContent(doc.data().content);
                setMemoDocId(doc.id);
              } else {
                setMemoContent('');
                setMemoDocId(null);
              }
            }, [userId, db]);

            const saveMemo = useCallback(async (date, content, docId) => {
              if (!userId || !db) return;
              const formattedDate = formatDateForFirestore(date);
              const diaryCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/diaryEntries`);

              if (content.trim() === '') {
                // 메모 내용이 비어있으면 삭제
                if (docId) {
                  await deleteDoc(doc(diaryCollectionRef, docId));
                  console.log(`메모 삭제됨: ${formattedDate}`);
                }
                return;
              }

              if (docId) {
                // 기존 문서 업데이트
                await updateDoc(doc(diaryCollectionRef, docId), { content: content });
                console.log(`메모 업데이트됨: ${formattedDate}`);
              } else {
                // 새 문서 추가
                const newDocRef = await addDoc(diaryCollectionRef, {
                  date: formattedDate,
                  content: content,
                  createdAt: new Date(),
                });
                setMemoDocId(newDocRef.id);
                console.log(`새 메모 추가됨: ${formattedDate}`);
              }
            }, [userId, db]);

            // 선택된 날짜가 변경될 때 메모 로드
            useEffect(() => {
              loadMemo(selectedDate);
            }, [selectedDate, loadMemo]);

            // 메모 내용이 변경될 때 디바운싱하여 저장
            useEffect(() => {
              if (memoSaveTimeoutRef.current) {
                clearTimeout(memoSaveTimeoutRef.current);
              }
              memoSaveTimeoutRef.current = setTimeout(() => {
                saveMemo(selectedDate, memoContent, memoDocId);
              }, 500); // 0.5초 디바운스

              return () => {
                if (memoSaveTimeoutRef.current) {
                  clearTimeout(memoSaveTimeoutRef.current);
                }
              };
            }, [memoContent, selectedDate, memoDocId, saveMemo]);


            const getDaysInMonth = (date) => {
              const year = date.getFullYear();
              const month = date.getMonth();
              const firstDay = new Date(year, month, 1).getDay(); // 0 = Sunday, 1 = Monday, ...
              const numDays = new Date(year, month + 1, 0).getDate();
              const days = [];

              // 이전 달의 빈 칸 채우기
              for (let i = 0; i < firstDay; i++) {
                days.push(null);
              }

              // 현재 달의 날짜 채우기
              for (let i = 1; i <= numDays; i++) {
                days.push(i);
              }
              return days;
            };

            const days = getDaysInMonth(currentMonth);
            const weekdays = ['일', '월', '화', '수', '목', '금', '토'];

            const goToPreviousMonth = () => {
              setCurrentMonth(prevMonth => new Date(prevMonth.getFullYear(), prevMonth.getMonth() - 1, 1));
            };

            const goToNextMonth = () => {
              setCurrentMonth(prevMonth => new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 1));
            };

            const handleDateClick = (day) => {
              if (day) {
                setSelectedDate(new Date(currentMonth.getFullYear(), currentMonth.getMonth(), day));
              }
            };

            return (
              <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-4 sm:p-8 font-inter flex flex-col items-center">
                <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700 max-w-4xl w-full text-center mt-8">
                  <h2 className="text-3xl font-bold mb-6 text-purple-400 flex items-center justify-center">
                    <svg className="w-8 h-8 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                    다이어리
                  </h2>

                  {/* 달력 */}
                  <div className="bg-gray-700 p-4 rounded-lg mb-6">
                    <div className="flex justify-between items-center mb-4">
                      <button onClick={goToPreviousMonth} className="text-blue-400 hover:text-blue-300 font-bold text-xl">{'<'}</button>
                      <h3 className="text-2xl font-bold text-white">
                        {currentMonth.getFullYear()}년 {currentMonth.getMonth() + 1}월
                      </h3>
                      <button onClick={goToNextMonth} className="text-blue-400 hover:text-blue-300 font-bold text-xl">{'>'}</button>
                    </div>
                    <div className="grid grid-cols-7 gap-2 text-sm">
                      {weekdays.map(day => (
                        <div key={day} className="font-bold text-gray-400">{day}</div>
                      ))}
                      {days.map((day, index) => (
                        <div
                          key={index}
                          className={`p-2 rounded-lg cursor-pointer ${day === null ? 'bg-gray-700' : 'hover:bg-gray-600'}
                            ${selectedDate.getDate() === day && selectedDate.getMonth() === currentMonth.getMonth() && selectedDate.getFullYear() === currentMonth.getFullYear() ? 'bg-blue-600 text-white font-bold' : 'bg-gray-700'}
                            ${new Date().getDate() === day && new Date().getMonth() === currentMonth.getMonth() && new Date().getFullYear() === currentMonth.getFullYear() && selectedDate.getDate() !== day ? 'border-2 border-yellow-400' : ''}
                          `}
                          onClick={() => handleDateClick(day)}
                        >
                          {day}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* 메모 */}
                  <div className="bg-gray-700 p-4 rounded-lg">
                    <h3 className="text-xl font-semibold mb-3 text-green-300">
                      {formatDateForFirestore(selectedDate)} 메모
                    </h3>
                    <textarea
                      className="w-full p-3 rounded-lg bg-gray-600 text-white border border-gray-500 focus:ring-2 focus:ring-green-500 focus:border-transparent h-32 resize-none"
                      placeholder="이 날의 메모를 작성하세요..."
                      value={memoContent}
                      onChange={(e) => setMemoContent(e.target.value)}
                    ></textarea>
                  </div>

                  <button
                    onClick={onBack}
                    className="mt-8 w-full bg-gradient-to-r from-gray-600 to-gray-700 text-white py-3 rounded-lg font-bold text-lg shadow-md hover:from-gray-700 hover:to-gray-800 transition duration-300 transform hover:scale-105"
                  >
                    뒤로 가기
                  </button>
                </div>
              </div>
            );


            function App() {
              const [userId, setUserId] = useState(null);
              const [tasks, setTasks] = useState([]);
              const [character, setCharacter] = useState({
                health: BASE_HEALTH,
                intelligence: BASE_INTELLIGENCE,
                strength: BASE_STRENGTH,
                gold: BASE_GOLD,
                level: BASE_LEVEL,
                experience: BASE_EXP,
                inventory: [], // 아이템 인벤토리 추가
                equippedItems: { weapon: null, armor: null, head: null }, // 장착 아이템 슬롯 추가
                hairId: 'none', // 아바타 머리 스타일 ID
                outfitId: 'none', // 아바타 옷 ID
                weaponId: 'none', // 아바타 무기 ID
              });
              const [newTaskName, setNewTaskName] = useState('');
              const [newTaskDifficulty, setNewTaskDifficulty] = useState('easy');
              const [newTaskType, setNewTaskType] = useState('general'); // 퀘스트 유형 추가
              const [loading, setLoading] = useState(true);
              const [isAuthReady, setIsAuthReady] = useState(false); // 인증 준비 상태
              const [currentScreen, setCurrentScreen] = useState('main'); // 현재 화면 상태

              // Firebase 인증 및 사용자 ID 설정
              useEffect(() => {
                const unsubscribe = onAuthStateChanged(auth, async (user) => {
                  if (user) {
                    setUserId(user.uid);
                    console.log("Firebase 인증 성공. User ID:", user.uid);
                  } else {
                    try {
                      if (initialAuthToken) {
                        await signInWithCustomToken(auth, initialAuthToken);
                        console.log("Firebase 커스텀 토큰으로 로그인 성공.");
                      } else {
                        await signInAnonymously(auth);
                        console.log("Firebase 익명 로그인 성공.");
                      }
                    } catch (error) {
                      console.error("Firebase 인증 오류:", error);
                    }
                  }
                  setIsAuthReady(true); // 인증 상태가 준비되었음을 표시
                });

                return () => unsubscribe();
              }, []);

              // 사용자 데이터 (캐릭터, 작업) 로드 및 실시간 동기화
              useEffect(() => {
                if (!isAuthReady || !userId) {
                  console.log("인증 또는 사용자 ID 준비 안 됨. 데이터 로드 건너뛰기.");
                  return;
                }

                setLoading(true);
                console.log("캐릭터 데이터 로드 시작...");

                // 캐릭터 데이터 실시간 동기화
                const characterDocRef = doc(db, `artifacts/${appId}/users/${userId}/character/main`);
                const unsubscribeCharacter = onSnapshot(characterDocRef, (docSnap) => {
                  if (docSnap.exists()) {
                    const data = docSnap.data();
                    console.log("Firestore에서 캐릭터 데이터 로드됨:", data);
                    // 아바타 파츠 ID 및 장착 아이템이 없는 경우 기본값 설정
                    setCharacter({
                      ...data,
                      hairId: data.hairId || 'none',
                      outfitId: data.outfitId || 'none',
                      weaponId: data.weaponId || 'none',
                      inventory: data.inventory || [], // 인벤토리 초기화
                      equippedItems: data.equippedItems || { weapon: null, armor: null, head: null }, // 장착 아이템 초기화
                    });
                  } else {
                    console.log("Firestore에 캐릭터 데이터 없음. 초기값으로 설정.");
                    // 캐릭터 데이터가 없으면 초기값으로 설정
                    const initialInventory = [];
                    const oldSword = ITEM_DATABASE.find(item => item.id === 'item_1');
                    if (oldSword) {
                      initialInventory.push({ ...oldSword, uniqueId: Date.now() + Math.random() });
                    }

                    setDoc(characterDocRef, {
                      health: BASE_HEALTH,
                      intelligence: BASE_INTELLIGENCE,
                      strength: BASE_STRENGTH,
                      gold: BASE_GOLD,
                      level: BASE_LEVEL,
                      experience: BASE_EXP,
                      inventory: initialInventory, // 시작 시 낡은 검 지급
                      equippedItems: { weapon: null, armor: null, head: null },
                      hairId: 'none',
                      outfitId: 'none',
                      weaponId: 'none',
                    })
                      .then(() => {
                        setCharacter({
                          health: BASE_HEALTH,
                          intelligence: BASE_INTELLIGENCE,
                          strength: BASE_STRENGTH,
                          gold: BASE_GOLD,
                          level: BASE_LEVEL,
                          experience: BASE_EXP,
                          inventory: initialInventory,
                          equippedItems: { weapon: null, armor: null, head: null },
                          hairId: 'none',
                          outfitId: 'none',
                          weaponId: 'none',
                        });
                        console.log("캐릭터 데이터 초기화 완료 (낡은 검 지급).");
                      })
                      .catch(error => console.error("캐릭터 초기화 오류:", error));
                  }
                  setLoading(false);
                }, (error) => {
                  console.error("캐릭터 데이터 로드 오류:", error);
                  setLoading(false);
                });

                // 작업 데이터 실시간 동기화
                const tasksCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/tasks`);
                const unsubscribeTasks = onSnapshot(tasksCollectionRef, (snapshot) => {
                  const fetchedTasks = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
                  setTasks(fetchedTasks);
                }, (error) => {
                  console.error("작업 데이터 로드 오류:", error);
                });

                return () => {
                  unsubscribeCharacter();
                  unsubscribeTasks();
                };
              }, [userId, isAuthReady]);

              // 새 작업 추가
              const addTask = async () => {
                if (!newTaskName.trim() || !userId) {
                  console.log("작업 이름을 입력해주세요.");
                  return;
                }

                try {
                  const tasksCollectionRef = collection(db, `artifacts/${appId}/users/${userId}/tasks`);
                  await addDoc(tasksCollectionRef, {
                    name: newTaskName,
                    difficulty: newTaskDifficulty,
                    type: newTaskType, // 퀘스트 유형 저장
                    completed: false,
                    createdAt: new Date(),
                  });
                  setNewTaskName('');
                  setNewTaskDifficulty('easy');
                  setNewTaskType('general');
                  console.log("작업이 성공적으로 추가되었습니다.");
                } catch (e) {
                  console.error("작업 추가 오류:", e);
                }
              };

              // 작업 완료 및 캐릭터 능력치 업데이트
              const completeTask = async (taskId, difficulty, type) => {
                if (!userId) return;

                try {
                  const taskDocRef = doc(db, `artifacts/${appId}/users/${userId}/tasks`, taskId);
                  const characterDocRef = doc(db, `artifacts/${appId}/users/${userId}/character/main`);

                  // 작업 완료 상태로 표시
                  await setDoc(taskDocRef, { completed: true }, { merge: true });

                  // 능력치, 골드, 경험치 계산
                  let statIncrease = 0;
                  let goldReward = 0;
                  let expGain = 0;

                  switch (difficulty) {
                    case 'easy':
                      statIncrease = 3;
                      goldReward = 10;
                      expGain = 20;
                      break;
                    case 'medium':
                      statIncrease = 7;
                      goldReward = 25;
                      expGain = 50;
                      break;
                    case 'hard':
                      statIncrease = 15;
                      goldReward = 100;
                      expGain = 100;
                      break;
                    default:
                      break;
                  }

                  // 캐릭터 능력치 업데이트
                  let updatedCharacter = { ...character };

                  // 퀘스트 유형에 따른 능력치 증가
                  switch (type) {
                    case 'physical':
                      updatedCharacter.strength += statIncrease;
                      updatedCharacter.health += Math.floor(statIncrease / 2); // 체력도 소폭 증가
                      break;
                    case 'mental':
                      updatedCharacter.intelligence += statIncrease;
                      updatedCharacter.health += Math.floor(statIncrease / 2); // 체력도 소폭 증가
                      break;
                    case 'production':
                      updatedCharacter.intelligence += Math.floor(statIncrease / 2);
                      updatedCharacter.strength += Math.floor(statIncrease / 2);
                      updatedCharacter.gold += goldReward; // 생산 퀘스트는 골드 보너스
                      break;
                    default: // 'general' 또는 기타
                      updatedCharacter.health += statIncrease;
                      updatedCharacter.intelligence += statIncrease;
                      updatedCharacter.strength += statIncrease;
                      break;
                  }

                  updatedCharacter.gold += goldReward;
                  updatedCharacter.experience += expGain;

                  // 레벨업 체크
                  const nextLevelExpThreshold = character.level * EXP_PER_LEVEL;
                  if (updatedCharacter.experience >= nextLevelExpThreshold) {
                    updatedCharacter.level += 1;
                    updatedCharacter.experience -= nextLevelExpThreshold; // 남은 경험치로 다음 레벨 시작
                    // 레벨업 보너스 (예: 모든 기본 능력치 5 증가)
                    updatedCharacter.health += 5;
                    updatedCharacter.intelligence += 5;
                    updatedCharacter.strength += 5;
                    console.log(`레벨업! 현재 레벨: ${updatedCharacter.level}`);
                  }

                  // 아이템 드롭 (20% 확률)
                  if (Math.random() < 0.2) {
                    const randomItemIndex = Math.floor(Math.random() * ITEM_DATABASE.length);
                    const droppedItem = { ...ITEM_DATABASE[randomItemIndex], uniqueId: Date.now() + Math.random() }; // 고유 ID 추가
                    updatedCharacter.inventory = [...(updatedCharacter.inventory || []), droppedItem];
                    console.log(`새로운 아이템 획득: ${droppedItem.name}`);
                  }

                  await setDoc(characterDocRef, updatedCharacter, { merge: true });
                  console.log("캐릭터 데이터 업데이트 완료 (퀘스트 완료).", updatedCharacter);


                  // 작업 목록에서 완료된 작업 제거 (UI 업데이트)
                  setTasks(prevTasks => prevTasks.filter(task => task.id !== taskId));

                } catch (e) {
                  console.error("작업 완료 오류:", e);
                }
              };

              // 아바타 파츠 변경 함수
              const updateCharacterPart = async (partName, partId) => {
                if (!userId) return;
                try {
                  const characterDocRef = doc(db, `artifacts/${appId}/users/${userId}/character/main`);
                  await updateDoc(characterDocRef, { [partName]: partId });
                  // UI를 즉시 업데이트하기 위해 로컬 상태도 업데이트
                  setCharacter(prevChar => ({ ...prevChar, [partName]: partId }));
                  console.log(`아바타 파츠 ${partName}을(를) ${partId}로 변경했습니다.`);
                } catch (e) {
                  console.error("아바타 파츠 변경 오류:", e);
                }
              };

              // 아이템 판매 함수
              const sellItem = async (itemToSell) => {
                if (!userId) return;

                const characterDocRef = doc(db, `artifacts/${appId}/users/${userId}/character/main`);

                // 장착된 아이템이라면 장착 해제
                if (character.equippedItems[itemToSell.type]?.uniqueId === itemToSell.uniqueId) {
                  // unequipItem이 Firestore 업데이트를 처리하므로, 여기서는 로컬 상태만 업데이트
                  setCharacter(prevChar => ({
                    ...prevChar,
                    equippedItems: { ...prevChar.equippedItems, [itemToSell.type]: null }
                  }));
                }

                const updatedInventory = character.inventory.filter(item => item.uniqueId !== itemToSell.uniqueId);
                const updatedGold = character.gold + itemToSell.value;

                try {
                  await updateDoc(characterDocRef, {
                    inventory: updatedInventory,
                    gold: updatedGold,
                    // 장착 해제 로직이 이미 Firestore를 업데이트했으므로 여기서는 inventory와 gold만 업데이트
                    equippedItems: character.equippedItems[itemToSell.type]?.uniqueId === itemToSell.uniqueId ?
                                  { ...character.equippedItems, [itemToSell.type]: null } : character.equippedItems
                  });
                  setCharacter(prevChar => ({
                    ...prevChar,
                    inventory: updatedInventory,
                    gold: updatedGold,
                    equippedItems: character.equippedItems[itemToSell.type]?.uniqueId === itemToSell.uniqueId ?
                                  { ...prevChar.equippedItems, [itemToSell.type]: null } : prevChar.equippedItems
                  }));
                  console.log(`${itemToSell.name}을(를) ${itemToSell.value} 골드에 판매했습니다. 업데이트된 인벤토리:`, updatedInventory);
                } catch (e) {
                  console.error("아이템 판매 오류:", e);
                }
              };

              // 아이템 장착 함수
              const equipItem = async (itemToEquip) => {
                if (!userId || !itemToEquip.type || !['weapon', 'armor', 'head'].includes(itemToEquip.type)) {
                  console.log("장착할 수 없는 아이템입니다.");
                  return;
                }

                const characterDocRef = doc(db, `artifacts/${appId}/users/${userId}/character/main`);
                let updatedCharacter = { ...character };
                let newEquippedItems = { ...updatedCharacter.equippedItems };

                // 현재 슬롯에 장착된 아이템이 있다면, 해당 아이템을 인벤토리로 돌려놓기
                const currentEquippedItem = newEquippedItems[itemToEquip.type];
                if (currentEquippedItem && currentEquippedItem.uniqueId !== itemToEquip.uniqueId) {
                  updatedCharacter.inventory.push(currentEquippedItem); // 인벤토리로 돌려놓기
                  console.log(`${currentEquippedItem.name}을(를) 장착 해제하고 인벤토리로 돌려놓았습니다.`);
                }

                // 새 아이템 장착
                // 인벤토리에서 해당 아이템을 제거하지 않음 (장착 상태만 표시)
                newEquippedItems[itemToEquip.type] = itemToEquip;
                updatedCharacter.equippedItems = newEquippedItems;

                try {
                  await updateDoc(characterDocRef, updatedCharacter);
                  setCharacter(updatedCharacter);
                  console.log(`${itemToEquip.name}을(를) 장착했습니다. 업데이트된 캐릭터:`, updatedCharacter);
                } catch (e) {
                  console.error("아이템 장착 오류:", e);
                }
              };

              // 아이템 장착 해제 함수
              const unequipItem = async (itemToUnequip) => {
                if (!userId || !itemToUnequip.type || !['weapon', 'armor', 'head'].includes(itemToUnequip.type)) {
                  console.log("장착 해제할 수 없는 아이템입니다.");
                  return;
                }

                const characterDocRef = doc(db, `artifacts/${appId}/users/${userId}/character/main`);
                let updatedCharacter = { ...character };
                let newEquippedItems = { ...updatedCharacter.equippedItems };

                // 장착 해제: 해당 슬롯을 null로 설정
                if (newEquippedItems[itemToUnequip.type] && newEquippedItems[itemToUnequip.type].uniqueId === itemToUnequip.uniqueId) {
                  newEquippedItems[itemToUnequip.type] = null;
                  updatedCharacter.equippedItems = newEquippedItems;
                } else {
                  console.log("해당 슬롯에 장착된 아이템이 아니거나 일치하지 않습니다.");
                  return;
                }

                try {
                  await updateDoc(characterDocRef, updatedCharacter);
                  setCharacter(updatedCharacter);
                  console.log(`${itemToUnequip.name}을(를) 장착 해제했습니다. 업데이트된 캐릭터:`, updatedCharacter);
                } catch (e) {
                  console.error("아이템 장착 해제 오류:", e);
                }
              };

              // 인벤토리에 아이템을 추가하는 함수 (테스트용 및 드롭용)
              const addItemToInventory = async (itemToAdd) => {
                if (!userId || !itemToAdd) {
                  console.log("아이템을 추가할 수 없습니다: 사용자 ID 또는 아이템이 유효하지 않습니다.");
                  return;
                }

                const characterDocRef = doc(db, `artifacts/${appId}/users/${userId}/character/main`);
                const newItem = { ...itemToAdd, uniqueId: Date.now() + Math.random() }; // 고유 ID 추가
                const updatedInventory = [...(character.inventory || []), newItem];

                console.log("인벤토리에 추가될 아이템:", newItem);
                console.log("업데이트될 인벤토리 (Firestore 전송 전):", updatedInventory);

                try {
                  await updateDoc(characterDocRef, {
                    inventory: updatedInventory,
                  });
                  setCharacter(prevChar => ({
                    ...prevChar,
                    inventory: updatedInventory,
                  }));
                  console.log(`${itemToAdd.name}을(를) 인벤토리에 성공적으로 추가했습니다.`);
                } catch (e) {
                  console.error("아이템 인벤토리 추가 오류:", e);
                }
              };

              // 아이템 구매 함수 (상점에서 사용)
              const buyItem = async (itemToBuy, quantity = 1) => {
                if (!userId) return;

                const characterDocRef = doc(db, `artifacts/${appId}/users/${userId}/character/main`);
                const cost = itemToBuy.value * quantity;

                if (character.gold < cost) {
                  console.log("골드가 부족합니다!");
                  // 사용자에게 골드 부족 메시지 표시 (예: 모달)
                  return;
                }

                let updatedCharacter = { ...character };
                updatedCharacter.gold -= cost;

                for (let i = 0; i < quantity; i++) {
                  const newItem = { ...itemToBuy, uniqueId: Date.now() + Math.random() + i }; // 고유 ID 부여
                  updatedCharacter.inventory.push(newItem);
                }

                try {
                  await updateDoc(characterDocRef, updatedCharacter);
                  setCharacter(updatedCharacter);
                  console.log(`${itemToBuy.name} ${quantity}개를 구매했습니다. 남은 골드: ${updatedCharacter.gold}`);
                } catch (e) {
                  console.error("아이템 구매 오류:", e);
                }
              };


              const { maxHealth, maxMana, attack, defense } = calculateDerivedStats(character);
              const nextLevelExpThreshold = character.level * EXP_PER_LEVEL;

              // __file_url__를 통해 업로드된 파일의 URL을 가져옵니다.
              // 아바타 뼈대 이미지를 더 이상 사용하지 않으므로 이 변수는 제거됩니다.
              // const avatarBaseImageUrl = typeof __file_url__ !== 'undefined' ? __file_url__['avatar.png'] : 'placeholder.png';


              if (loading) {
                return (
                  <div className="flex items-center justify-center min-h-screen bg-gray-900 text-white">
                    <div className="text-lg font-semibold">로딩 중...</div>
                  </div>
                );
              }

              // 메인 화면 렌더링
              const renderMainScreen = () => (
                <div className="min-h-screen bg-gradient-to-br from-gray-900 to-gray-800 text-white p-4 sm:p-8 font-inter flex flex-col pb-20"> {/* padding-bottom 추가 */}
                  {/* 사용자 ID 표시 */}
                  <div className="flex justify-end text-sm text-gray-400 mb-4">
                    사용자 ID: <span className="font-mono ml-2">{userId || '로그인 중...'}</span>
                  </div>

                  <h1 className="text-4xl sm:text-5xl font-bold text-center mb-10 text-yellow-400 drop-shadow-lg">
                    <span className="block mb-2">ToDoQuest</span>
                    <span className="text-xl sm:text-2xl font-normal text-gray-300">RPG 일정 관리</span>
                  </h1>

                  <div className="max-w-6xl mx-auto grid grid-cols-1 md:grid-cols-2 gap-8 flex-grow"> {/* flex-grow 추가 */}
                    {/* 캐릭터 정보 카드 */}
                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700">
                      <h2 className="text-2xl font-semibold mb-4 text-purple-400 flex items-center">
                        <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"></path></svg>
                        내 캐릭터
                      </h2>
                      {/* 아바타 표시 영역 - 클릭 시 꾸미기 화면으로 이동 */}
                      <button
                        onClick={() => setCurrentScreen('avatarCustomization')}
                        className="flex justify-center mb-4 focus:outline-none focus:ring-2 focus:ring-blue-500 rounded-full mx-auto"
                      >
                        <div className={`w-24 h-24 flex items-center justify-center border-4 border-gray-600 overflow-hidden`}>
                          <PixelAvatar
                            // baseImageSrc prop 제거
                            hairId={character.hairId}
                            outfitId={character.outfitId}
                            weaponId={character.weaponId}
                          />
                        </div>
                      </button>
                      <div className="space-y-3">
                        <div className="flex items-center">
                          <span className="text-gray-400 w-24">레벨:</span>
                          <span className="font-bold text-lg text-green-400">{character.level}</span>
                        </div>
                        <div className="flex items-center">
                          <span className="text-gray-400 w-24">경험치:</span>
                          <span className="font-bold text-lg text-yellow-300">{character.experience} / {nextLevelExpThreshold}</span>
                        </div>
                        <div className="flex items-center">
                          <span className="text-gray-400 w-24">체력:</span>
                          <span className="font-bold text-lg text-red-400">{character.health} / {maxHealth}</span>
                        </div>
                        <div className="flex items-center">
                          <span className="text-gray-400 w-24">지능:</span>
                          <span className="font-bold text-lg text-blue-400">{character.intelligence}</span>
                        </div>
                        <div className="flex items-center">
                          <span className="text-gray-400 w-24">힘:</span>
                          <span className="font-bold text-lg text-orange-400">{character.strength}</span>
                        </div>
                        <div className="flex items-center">
                          <span className="text-gray-400 w-24">공격력:</span>
                          <span className="font-bold text-lg text-red-500">{attack.toFixed(0)}</span>
                        </div>
                        <div className="flex items-center">
                          <span className="text-gray-400 w-24">방어력:</span>
                          <span className="font-bold text-lg text-blue-500">{defense.toFixed(0)}</span>
                        </div>
                        <div className="flex items-center">
                          <span className="text-gray-400 w-24">골드:</span>
                          <span className="font-bold text-lg text-yellow-500 flex items-center">
                            <svg className="w-5 h-5 mr-1" fill="currentColor" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z" clipRule="evenodd"></path></svg>
                            {character.gold}
                          </span>
                        </div>
                        {/* 장착 아이템 표시 */}
                        <div className="mt-4 pt-4 border-t border-gray-700">
                          <h3 className="text-lg font-semibold text-gray-300 mb-2">장착 아이템</h3>
                          <ul className="text-sm text-gray-400 space-y-1">
                            <li>무기: {character.equippedItems?.weapon?.name || '없음'}</li>
                            <li>방어구: {character.equippedItems?.armor?.name || '없음'}</li>
                            <li>머리: {character.equippedItems?.head?.name || '없음'}</li>
                          </ul>
                        </div>
                      </div>
                    </div>

                    {/* 새 작업 추가 카드 */}
                    <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700">
                      <h2 className="text-2xl font-semibold mb-4 text-cyan-400 flex items-center">
                        <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 9v3m0 0v3m0-3h3m-3 0H9m12 0a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                        새로운 퀘스트 추가
                      </h2>
                      <div className="space-y-4">
                        <input
                          type="text"
                          placeholder="퀘스트 이름"
                          className="w-full p-3 rounded-lg bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          value={newTaskName}
                          onChange={(e) => setNewTaskName(e.target.value)}
                        />
                        <select
                          className="w-full p-3 rounded-lg bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          value={newTaskDifficulty}
                          onChange={(e) => setNewTaskDifficulty(e.target.value)}
                        >
                          <option value="easy">난이도: 쉬움</option>
                          <option value="medium">난이도: 보통</option>
                          <option value="hard">난이도: 어려움</option>
                        </select>
                        <select
                          className="w-full p-3 rounded-lg bg-gray-700 text-white border border-gray-600 focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                          value={newTaskType}
                          onChange={(e) => setNewTaskType(e.target.value)}
                        >
                          <option value="general">유형: 일반</option>
                          <option value="physical">유형: 운동 (힘/체력)</option>
                          <option value="mental">유형: 공부 (지능/체력)</option>
                          <option value="production">유형: 생산 (지능/힘/골드)</option>
                        </select>
                        <button
                          onClick={addTask}
                          className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 rounded-lg font-bold text-lg shadow-md hover:from-blue-700 hover:to-purple-700 transition duration-300 transform hover:scale-105"
                        >
                          퀘스트 생성
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* 현재 퀘스트 목록 */}
                  <div className="bg-gray-800 p-6 rounded-2xl shadow-xl border border-gray-700 mt-8 max-w-6xl mx-auto w-full">
                    <h2 className="text-2xl font-semibold mb-4 text-lime-400 flex items-center">
                      <svg className="w-6 h-6 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01"></path></svg>
                      나의 퀘스트 목록
                    </h2>
                    {tasks.length === 0 ? (
                      <p className="text-gray-400 text-center py-4">아직 퀘스트가 없습니다. 새로운 퀘스트를 추가해보세요!</p>
                    ) : (
                      <ul className="space-y-3">
                        {tasks.map((task) => (
                          <li
                            key={task.id}
                            className="flex flex-col sm:flex-row items-start sm:items-center justify-between bg-gray-700 p-4 rounded-lg shadow-sm border border-gray-600"
                          >
                            <div className="mb-2 sm:mb-0">
                              <p className="text-lg font-medium text-white">{task.name}</p>
                              <p className="text-sm text-gray-400">
                                난이도: <span className={`font-semibold ${task.difficulty === 'easy' ? 'text-green-300' : task.difficulty === 'medium' ? 'text-yellow-300' : 'text-red-300'}`}>
                                  {task.difficulty === 'easy' ? '쉬움' : task.difficulty === 'medium' ? '보통' : '어려움'}
                                </span>
                                <span className="ml-4">유형: {
                                  task.type === 'physical' ? '운동' :
                                  task.type === 'mental' ? '공부' :
                                  task.type === 'production' ? '생산' : '일반'
                                }</span>
                              </p>
                            </div>
                            <button
                              onClick={() => completeTask(task.id, task.difficulty, task.type)}
                              className="bg-gradient-to-r from-green-500 to-teal-500 text-white px-4 py-2 rounded-lg font-bold shadow-md hover:from-green-600 hover:to-teal-600 transition duration-300 transform hover:scale-105"
                            >
                              퀘스트 완료
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* 하단 내비게이션 바 */}
                  <div className="fixed bottom-0 left-0 right-0 bg-gray-800 border-t border-gray-700 p-4 flex justify-around items-center shadow-lg z-10">
                    <button
                      onClick={() => setCurrentScreen('items')}
                      className="flex flex-col items-center text-gray-300 hover:text-blue-400 transition duration-200 focus:outline-none"
                    >
                      <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10m-4-2h8m-4 2v4"></path></svg>
                      <span className="text-xs">아이템</span>
                    </button>
                    <button
                      onClick={() => setCurrentScreen('shop')}
                      className="flex flex-col items-center text-gray-300 hover:text-yellow-400 transition duration-200 focus:outline-none"
                    >
                      <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                      <span className="text-xs">상점가</span>
                    </button>
                    <button
                      onClick={() => setCurrentScreen('guild')}
                      className="flex flex-col items-center text-gray-300 hover:text-pink-400 transition duration-200 focus:outline-none"
                    >
                      <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 20h2a2 2 0 002-2V7a2 2 0 00-2-2h-2m-4 14v-2m4 2v-2m-10 2H4A2 2 0 012 18V7a2 2 0 012-2h2m4 14V7m0 10h4m-4 4H9.5M4 7h16M7 7h10"></path></svg>
                      <span className="text-xs">길드</span>
                    </button>
                    <button
                      onClick={() => setCurrentScreen('adventure')}
                      className="flex flex-col items-center text-gray-300 hover:text-green-400 transition duration-200 focus:outline-none"
                    >
                      <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.747 0-3.332.477-4.5 1.253"></path></svg>
                      <span className="text-xs">모험 시작</span>
                    </button>
                    <button
                      onClick={() => setCurrentScreen('other')}
                      className="flex flex-col items-center text-gray-300 hover:text-purple-400 transition duration-200 focus:outline-none"
                    >
                      <svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.568.35 1.253.542 1.96.542z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                      <span className="text-xs">기타</span>
                    </button>
                  </div>
                </div>
              );

              // 현재 화면에 따라 렌더링
              switch (currentScreen) {
                case 'main':
                  return renderMainScreen();
                case 'avatarCustomization':
                  return (
                    <AvatarCustomizationScreen
                      character={character}
                      updateCharacterPart={updateCharacterPart}
                      onClose={() => setCurrentScreen('main')}
                    />
                  );
                case 'items':
                  return (
                    <ItemsScreen
                      character={character}
                      onBack={() => setCurrentScreen('main')}
                      sellItem={sellItem}
                      equipItem={equipItem}
                      unequipItem={unequipItem}
                    />
                  );
                case 'shop':
                  return (
                    <ShopScreen
                      character={character} // ShopScreen에 character prop 전달
                      onBack={() => setCurrentScreen('main')}
                      buyItem={buyItem} // buyItem 함수 전달
                    />
                  );
                case 'guild':
                  return (
                    <GuildScreen
                      onBack={() => setCurrentScreen('main')}
                    />
                  );
                case 'adventure':
                  return (
                    <AdventureScreen
                      onBack={() => setCurrentScreen('main')}
                    />
                  );
                case 'other':
                  return (
                    <OtherScreen
                      onBack={() => setCurrentScreen('main')}
                      userId={userId} // userId와 db를 OtherScreen으로 전달
                      db={db}
                    />
                  );
                default:
                  return renderMainScreen();
              }
            }

            export default App;