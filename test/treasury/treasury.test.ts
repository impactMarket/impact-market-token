// @ts-ignore
import chai, { should } from "chai";
// @ts-ignore
import chaiAsPromised from "chai-as-promised";
// @ts-ignore
import { deployments, ethers } from "hardhat";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import * as ethersTypes from "ethers";
import { toEther } from "../utils/helpers";
import {
	createPool,
	getExchangePath,
	swap,
	uniswapNFTPositionManagerAddress,
	uniswapQuoterAddress,
	uniswapRouterAddress,
} from "../utils/uniswap";

const NFTPositionManagerABI =
	require("../../util/abi/uniswap/periphery/NonfungiblePositionManager.json").abi;

chai.use(chaiAsPromised);
const expect = chai.expect;
should();

export enum LpStrategy {
	NONE = 0,
	MainCoin = 1,
	SecondaryCoin = 2,
}

describe.only("Treasury", () => {
	//these tests work only on a celo mainnet fork network
	let owner: SignerWithAddress;
	let user1: SignerWithAddress;
	let user2: SignerWithAddress;
	let user3: SignerWithAddress;

	let ImpactProxyAdmin: ethersTypes.Contract;
	let PACT: ethersTypes.Contract;
	let Treasury: ethersTypes.Contract;
	let TreasuryImplementation: ethersTypes.Contract;
	let TreasuryLpSwap: ethersTypes.Contract;
	let CommunityAdmin: ethersTypes.Contract;
	let cUSD: ethersTypes.Contract;
	let mUSD: ethersTypes.Contract;
	let cTKN: ethersTypes.Contract;
	let NFTPositionManager: ethersTypes.Contract;

	const FAKE_ADDRESS = "0x000000000000000000000000000000000000dEaD";

	const deploy = deployments.createFixture(async () => {
		await deployments.fixture("Test", { fallbackToGlobal: false });

		[owner, user1, user2, user3] = await ethers.getSigners();

		TreasuryImplementation = await ethers.getContractAt(
			"TreasuryImplementation",
			(
				await deployments.get("TreasuryImplementation")
			).address
		);

		Treasury = await ethers.getContractAt(
			"TreasuryImplementation",
			(
				await deployments.get("TreasuryProxy")
			).address
		);

		CommunityAdmin = await ethers.getContractAt(
			"CommunityAdminImplementation",
			(
				await deployments.get("CommunityAdminProxy")
			).address
		);

		ImpactProxyAdmin = await ethers.getContractAt(
			"ImpactProxyAdmin",
			(
				await deployments.get("ImpactProxyAdmin")
			).address
		);

		PACT = await ethers.getContractAt(
			"PACTToken",
			(
				await deployments.get("PACTToken")
			).address
		);

		cUSD = await ethers.getContractAt(
			"TokenMock",
			(
				await deployments.get("TokenMock")
			).address
		);

		TreasuryLpSwap = await ethers.getContractAt(
			"TreasuryLpSwapImplementation",
			(
				await deployments.get("TreasuryLpSwapProxy")
			).address
		);

		NFTPositionManager = await ethers.getContractAt(
			NFTPositionManagerABI,
			uniswapNFTPositionManagerAddress
		);

		const tokenFactory = await ethers.getContractFactory("TokenMock");
		mUSD = await tokenFactory.deploy("mUSD", "mUSD");
		cTKN = await tokenFactory.deploy("cTKN", "cTKN");
	});

	describe("Treasury - Basic", () => {
		before(async function () {});

		beforeEach(async () => {
			await deploy();
		});

		it("Should have correct values", async function () {
			expect(await Treasury.communityAdmin()).to.be.equal(
				CommunityAdmin.address
			);
			expect(await Treasury.owner()).to.be.equal(owner.address);
			expect(await Treasury.getVersion()).to.be.equal(2);
			expect(await Treasury.tokenListLength()).to.be.equal(1);
			expect(await Treasury.tokenListAt(0)).to.be.equal(cUSD.address);
		});

		it("Should transfer founds to address is owner", async function () {
			const initialBalance = await cUSD.balanceOf(owner.address);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(0);
			await cUSD.mint(Treasury.address, toEther("100"));
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther("100")
			);
			await Treasury.transfer(
				cUSD.address,
				owner.address,
				toEther("100")
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(0);
			expect(await cUSD.balanceOf(owner.address)).to.be.equal(
				initialBalance.add(toEther("100"))
			);
		});

		it("Should update communityAdmin if owner", async function () {
			await Treasury.updateCommunityAdmin(user1.address);
			expect(await Treasury.communityAdmin()).to.be.equal(user1.address);
		});

		it("Should transfer founds to address is communityAdmin", async function () {
			const initialBalance = await cUSD.balanceOf(owner.address);
			await Treasury.updateCommunityAdmin(user1.address);

			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(0);
			await cUSD.mint(Treasury.address, toEther("100"));
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther("100")
			);
			await Treasury.connect(user1).transfer(
				cUSD.address,
				owner.address,
				toEther("100")
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(0);
			expect(await cUSD.balanceOf(owner.address)).to.be.equal(
				initialBalance.add(toEther("100"))
			);
		});

		it("Should update implementation if owner", async function () {
			const NewTreasuryImplementationFactory =
				await ethers.getContractFactory("TreasuryImplementation");
			const NewTreasuryImplementation =
				await NewTreasuryImplementationFactory.deploy();

			await expect(
				ImpactProxyAdmin.upgrade(
					Treasury.address,
					NewTreasuryImplementation.address
				)
			).to.be.fulfilled;
			expect(
				await ImpactProxyAdmin.getProxyImplementation(Treasury.address)
			).to.be.equal(NewTreasuryImplementation.address);
		});

		it("Should not update implementation if not owner", async function () {
			const NewTreasuryImplementationFactory =
				await ethers.getContractFactory("TreasuryImplementation");
			const NewTreasuryImplementation =
				await NewTreasuryImplementationFactory.deploy();

			await expect(
				ImpactProxyAdmin.connect(user1).upgrade(
					Treasury.address,
					NewTreasuryImplementation.address
				)
			).to.be.rejectedWith("Ownable: caller is not the owner");
			expect(
				await ImpactProxyAdmin.getProxyImplementation(Treasury.address)
			).to.be.equal(TreasuryImplementation.address);
		});

		it("Should not update PACT if not owner", async function () {
			await expect(
				Treasury.connect(user1).updatePACT(FAKE_ADDRESS)
			).to.be.rejectedWith(
				"Treasury: caller is not the owner nor ImpactMarketCouncil"
			);
			expect(await Treasury.PACT()).to.be.equal(PACT.address);
		});

		it("Should update PACT if owner", async function () {
			await expect(Treasury.updatePACT(FAKE_ADDRESS)).to.be.fulfilled;
			expect(await Treasury.PACT()).to.be.equal(FAKE_ADDRESS);
		});
	});

	let cUSDToMUSDTokenId: number;
	let mUSDToCTKNTokenId: number;
	let cUSDToPACTTokenId: number;
	let mUSDToPACTTokenId: number;

	async function createPools() {
		await cUSD.mint(owner.address, toEther(1000000000));
		await mUSD.mint(owner.address, toEther(1000000000));
		await cTKN.mint(owner.address, toEther(1000000000));

		cUSDToMUSDTokenId = await createPool(
			owner,
			cUSD,
			mUSD,
			toEther(1000000),
			toEther(1000000)
		);

		mUSDToCTKNTokenId = await createPool(
			owner,
			mUSD,
			cTKN,
			toEther(1000000),
			toEther(500000)
		);

		cUSDToPACTTokenId = await createPool(
			owner,
			cUSD,
			PACT,
			toEther(1000000),
			toEther(1000000),
			TreasuryLpSwap.address
		);

		mUSDToPACTTokenId = await createPool(
			owner,
			mUSD,
			PACT,
			toEther(1000000),
			toEther(500000),
			TreasuryLpSwap.address
		);
	}

	describe("Treasury - new tokens", () => {
		before(async function () {});

		beforeEach(async () => {
			await deploy();
			await createPools();
		});

		it.only("Should convertAmount #1", async function () {
			const exchangePath = getExchangePath(mUSD, cUSD);
			await Treasury.setToken(
				mUSD.address,
				toEther(0.9),
				LpStrategy.NONE,
				0,
				0,
				0,
				exchangePath,
				"0x"
			);
			await mUSD.mint(Treasury.address, toEther(1));

			await expect(
				Treasury.convertAmount(mUSD.address, toEther(1), 0, "0x")
			)
				.to.emit(Treasury, "AmountConverted")
				.withArgs(
					mUSD.address,
					toEther(1),
					0,
					exchangePath,
					toEther("0.989999019900970298")
				);

			expect(await mUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther(0)
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther("0.989999019900970298")
			);
		});

		it("Should set token if owner", async function () {
			const exchangePathToCUSD = getExchangePath(mUSD, cUSD);
			const exchangePathToPACT = getExchangePath(mUSD, PACT);

			await expect(
				Treasury.setToken(
					mUSD.address,
					toEther(1),
					LpStrategy.SecondaryCoin,
					123,
					321,
					0,
					exchangePathToCUSD,
					exchangePathToPACT
				)
			)
				.to.emit(Treasury, "TokenSet")
				.withArgs(mUSD.address);

			const token = await Treasury.tokens(mUSD.address);
			expect(token.rate).to.be.equal(toEther(1));
			expect(token.lpStrategy).to.be.equal(LpStrategy.SecondaryCoin);
			expect(token.lpPercentage).to.be.equal(123);
			expect(token.lpMinLimit).to.be.equal(321);
			expect(token.exchangePathToCUSD).to.be.equal(exchangePathToCUSD);
			expect(token.exchangePathToPACT).to.be.equal(exchangePathToPACT);
			expect(token.uniswapNFTPositionManagerId).to.be.equal(0);
			expect(await Treasury.tokenListLength()).to.be.equal(2);
			expect(await Treasury.tokenListAt(0)).to.be.equal(cUSD.address);
			expect(await Treasury.tokenListAt(1)).to.be.equal(mUSD.address);
		});

		it("Should set token if impactMarketCouncil", async function () {
			await CommunityAdmin.updateImpactMarketCouncil(user3.address);

			const exchangePathToCUSD = getExchangePath(mUSD, cUSD);
			const exchangePathToPACT = getExchangePath(mUSD, PACT);

			await expect(
				Treasury.connect(user3).setToken(
					mUSD.address,
					toEther(1),
					LpStrategy.SecondaryCoin,
					123,
					321,
					0,
					exchangePathToCUSD,
					exchangePathToPACT
				)
			)
				.to.emit(Treasury, "TokenSet")
				.withArgs(mUSD.address);

			const token = await Treasury.tokens(mUSD.address);
			expect(token.rate).to.be.equal(toEther(1));
			expect(token.lpStrategy).to.be.equal(LpStrategy.SecondaryCoin);

			expect(token.lpPercentage).to.be.equal(123);
			expect(token.lpMinLimit).to.be.equal(321);
			expect(token.exchangePathToCUSD).to.be.equal(exchangePathToCUSD);
			expect(token.exchangePathToPACT).to.be.equal(exchangePathToPACT);
			expect(token.uniswapNFTPositionManagerId).to.be.equal(0);
			expect(await Treasury.tokenListLength()).to.be.equal(2);
			expect(await Treasury.tokenListAt(0)).to.be.equal(cUSD.address);
			expect(await Treasury.tokenListAt(1)).to.be.equal(mUSD.address);
		});

		it("Should not set token if not owner", async function () {
			await expect(
				Treasury.connect(user1).setToken(
					mUSD.address,
					toEther(0.5),
					LpStrategy.MainCoin,
					0,
					0,
					0,
					"0x",
					"0x"
				)
			).to.be.rejectedWith(
				"Treasury: caller is not the owner nor ImpactMarketCouncil"
			);

			const token = await Treasury.tokens(mUSD.address);

			expect(token.rate).to.be.equal(0);
			expect(token.lpStrategy).to.be.equal(LpStrategy.NONE);
			expect(token.uniswapNFTPositionManagerId).to.be.equal(0);
			expect(token.exchangePathToCUSD).to.be.equal("0x");
			expect(token.exchangePathToPACT).to.be.equal("0x");
			expect(await Treasury.tokenListLength()).to.be.equal(1);
		});

		it("Should setToken without exchangePath", async function () {
			await expect(
				Treasury.setToken(
					mUSD.address,
					toEther(0.5),
					LpStrategy.NONE,
					0,
					0,
					0,
					"0x",
					"0x"
				)
			).to.be.fulfilled;

			const token = await Treasury.tokens(mUSD.address);
			expect(token.rate).to.be.equal(toEther(0.5));
			expect(token.lpStrategy).to.be.equal(LpStrategy.NONE);
			expect(token.uniswapNFTPositionManagerId).to.be.equal(0);
			expect(token.exchangePathToCUSD).to.be.equal("0x");
			expect(token.exchangePathToPACT).to.be.equal("0x");
			expect(await Treasury.tokenListLength()).to.be.equal(2);
		});

		it("Should not set token without rate", async function () {
			await expect(
				Treasury.setToken(
					mUSD.address,
					0,
					LpStrategy.NONE,
					0,
					0,
					0,
					"0x",
					"0x"
				)
			).to.be.rejectedWith("Treasury::setToken: Invalid rate");
		});

		it("Should not set token with invalid exchangePathToCUSD #1", async function () {
			const exchangePath = getExchangePath(cTKN, cUSD);
			await expect(
				Treasury.setToken(
					mUSD.address,
					toEther(1),
					LpStrategy.NONE,
					0,
					0,
					0,
					exchangePath,
					"0x"
				)
			).to.be.rejectedWith(
				"Transaction reverted without a reason string"
			);

			const token = await Treasury.tokens(mUSD.address);
			expect(token.rate).to.be.equal(0);
			expect(token.lpStrategy).to.be.equal(LpStrategy.NONE);
			expect(token.uniswapNFTPositionManagerId).to.be.equal(0);
			expect(token.exchangePathToCUSD).to.be.equal("0x");
			expect(token.exchangePathToPACT).to.be.equal("0x");
			expect(await Treasury.tokenListLength()).to.be.equal(1);
		});

		it("Should not set token with invalid exchangePathToPACT #1", async function () {
			const exchangePath = getExchangePath(cTKN, PACT);
			await expect(
				Treasury.setToken(
					mUSD.address,
					toEther(1),
					LpStrategy.NONE,
					0,
					0,
					0,
					"0x",
					exchangePath
				)
			).to.be.rejectedWith(
				"Transaction reverted without a reason string"
			);

			const token = await Treasury.tokens(mUSD.address);
			expect(token.rate).to.be.equal(0);
			expect(token.lpStrategy).to.be.equal(LpStrategy.NONE);
			expect(token.uniswapNFTPositionManagerId).to.be.equal(0);
			expect(token.exchangePathToCUSD).to.be.equal("0x");
			expect(token.exchangePathToPACT).to.be.equal("0x");
		});

		it("Should not remove token if not owner", async function () {
			await Treasury.setToken(
				mUSD.address,
				toEther(0.5),
				LpStrategy.NONE,
				0,
				0,
				0,
				"0x",
				"0x"
			);

			await expect(
				Treasury.connect(user1).removeToken(mUSD.address)
			).to.be.rejectedWith(
				"Treasury: caller is not the owner nor ImpactMarketCouncil"
			);
		});

		it("Should revert when removing an invalid token", async function () {
			await expect(Treasury.removeToken(mUSD.address)).to.be.rejectedWith(
				"Treasury::removeToken: this is not a token"
			);
		});

		it("Should remove token if owner", async function () {
			await Treasury.setToken(
				mUSD.address,
				toEther(0.5),
				LpStrategy.MainCoin,
				123,
				321,
				0,
				getExchangePath(mUSD, cUSD),
				getExchangePath(mUSD, PACT)
			);

			expect(await Treasury.tokenListLength()).to.be.equal(2);
			await expect(Treasury.removeToken(mUSD.address))
				.to.emit(Treasury, "TokenRemoved")
				.withArgs(mUSD.address);

			const token = await Treasury.tokens(mUSD.address);
			expect(token.rate).to.be.equal(0);
			expect(token.lpStrategy).to.be.equal(LpStrategy.NONE);
			expect(token.lpPercentage).to.be.equal(0);
			expect(token.lpMinLimit).to.be.equal(0);
			expect(token.exchangePathToCUSD).to.be.equal("0x");
			expect(token.exchangePathToPACT).to.be.equal("0x");
			expect(token.uniswapNFTPositionManagerId).to.be.equal(0);
			expect(await Treasury.tokenListLength()).to.be.equal(1);
		});

		it("Should getConvertedAmount, rate = 1 #1", async function () {
			const exchangePath = getExchangePath(mUSD, cUSD);
			await Treasury.setToken(
				mUSD.address,
				toEther(1),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath,
				"0x"
			);

			expect(
				await Treasury.callStatic.getConvertedAmount(
					mUSD.address,
					toEther(1)
				)
			).to.be.equal(toEther("0.989999019900970298"));
		});

		it("Should getConvertedAmount, rate = 1 #2", async function () {
			const exchangePath = getExchangePath(mUSD, cUSD);
			await Treasury.setToken(
				mUSD.address,
				toEther(1),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath,
				"0x"
			);

			expect(
				await Treasury.callStatic.getConvertedAmount(
					mUSD.address,
					toEther(100)
				)
			).to.be.equal(toEther("98.990199970202949907"));
		});

		it("Should getConvertedAmount, rate != 1 #1", async function () {
			const exchangePath = getExchangePath(mUSD, cUSD);
			await Treasury.setToken(
				mUSD.address,
				toEther(0.5),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath,
				"0x"
			);

			expect(
				await Treasury.callStatic.getConvertedAmount(
					mUSD.address,
					toEther(1)
				)
			).to.be.equal(toEther("0.989999019900970298").div(2));
		});

		it("Should getConvertedAmount, rate != 1 #2", async function () {
			const exchangePath = getExchangePath(mUSD, cUSD);
			await Treasury.setToken(
				mUSD.address,
				toEther(2),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath,
				"0x"
			);

			expect(
				await Treasury.callStatic.getConvertedAmount(
					mUSD.address,
					toEther(1)
				)
			).to.be.equal(toEther("0.989999019900970298").mul(2));
		});

		it("Should not getConvertedAmount if invalid token", async function () {
			await expect(
				Treasury.callStatic.getConvertedAmount(mUSD.address, toEther(1))
			).to.be.rejectedWith(
				"Treasury::getConvertedAmount: this is not a valid token"
			);
		});

		it("Should not convertAmount if not owner", async function () {
			const exchangePath = getExchangePath(mUSD, cUSD);
			await Treasury.setToken(
				mUSD.address,
				toEther(2),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath,
				"0x"
			);

			await expect(
				Treasury.connect(user1).convertAmount(
					mUSD.address,
					toEther(1),
					0,
					"0x"
				)
			).to.be.rejectedWith(
				"Treasury: caller is not the owner nor ImpactMarketCouncil"
			);
		});

		it("Should not convertAmount if invalid token", async function () {
			await expect(
				Treasury.convertAmount(mUSD.address, toEther(1), 0, "0x")
			).to.be.rejectedWith(
				"Treasury::convertAmount: this is not a valid token"
			);
		});

		it("Should convertAmount #1", async function () {
			const exchangePath = getExchangePath(mUSD, cUSD);
			await Treasury.setToken(
				mUSD.address,
				toEther(0.9),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath,
				"0x"
			);
			await mUSD.mint(Treasury.address, toEther(1));

			await expect(
				Treasury.convertAmount(mUSD.address, toEther(1), 0, "0x")
			)
				.to.emit(Treasury, "AmountConverted")
				.withArgs(
					mUSD.address,
					toEther(1),
					0,
					exchangePath,
					toEther("0.989999019900970298")
				);

			expect(await mUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther(0)
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther("0.989999019900970298")
			);
		});

		it("Should convertAmount #2", async function () {
			const exchangePath = getExchangePath(mUSD, cUSD);
			await Treasury.setToken(
				mUSD.address,
				toEther(0.9),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath,
				"0x"
			);
			await mUSD.mint(Treasury.address, toEther(1000));

			await expect(
				Treasury.convertAmount(mUSD.address, toEther(1000), 0, "0x")
			)
				.to.emit(Treasury, "AmountConverted")
				.withArgs(
					mUSD.address,
					toEther(1000),
					0,
					exchangePath,
					toEther("989.020869339354039500")
				);

			expect(await mUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther(0)
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther("989.020869339354039500")
			);
		});

		it("Should convertAmount #3", async function () {
			const exchangePath = getExchangePath(mUSD, cUSD);
			await Treasury.setToken(
				mUSD.address,
				toEther(0.9),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath,
				"0x"
			);
			await mUSD.mint(Treasury.address, toEther(500000));

			await expect(
				Treasury.convertAmount(mUSD.address, toEther(500000), 0, "0x")
			)
				.to.emit(Treasury, "AmountConverted")
				.withArgs(
					mUSD.address,
					toEther(500000),
					0,
					exchangePath,
					toEther("331103.678929765886293590")
				);

			expect(await mUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther(0)
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther("331103.678929765886293590")
			);
		});

		it("Should convertAmount #4", async function () {
			const exchangePath = getExchangePath(mUSD, cUSD);
			await Treasury.setToken(
				mUSD.address,
				toEther(0.9),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath,
				"0x"
			);
			await mUSD.mint(Treasury.address, toEther(1000000));

			await expect(
				Treasury.convertAmount(mUSD.address, toEther(1000000), 0, "0x")
			)
				.to.emit(Treasury, "AmountConverted")
				.withArgs(
					mUSD.address,
					toEther(1000000),
					0,
					exchangePath,
					toEther("497487.437185929648254671")
				);

			expect(await mUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther(0)
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther("497487.437185929648254671")
			);
		});

		it("Should convertAmount #5", async function () {
			const exchangePath = getExchangePath(mUSD, cUSD);
			await Treasury.setToken(
				mUSD.address,
				toEther(0.9),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath,
				"0x"
			);
			await mUSD.mint(Treasury.address, toEther(1000000));

			await expect(
				Treasury.convertAmount(mUSD.address, toEther(500000), 0, "0x")
			)
				.to.emit(Treasury, "AmountConverted")
				.withArgs(
					mUSD.address,
					toEther(500000),
					0,
					exchangePath,
					toEther("331103.678929765886293590")
				);
			await expect(
				Treasury.convertAmount(mUSD.address, toEther(500000), 0, "0x")
			)
				.to.emit(Treasury, "AmountConverted")
				.withArgs(
					mUSD.address,
					toEther(500000),
					0,
					exchangePath,
					toEther("166383.758256163761961081")
				);

			expect(await mUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther(0)
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther("497487.437185929648254671")
			);
		});

		it("Should convertAmount #6", async function () {
			const exchangePath1 = getExchangePath(mUSD, cUSD);
			const exchangePath2 = getExchangePath(cTKN, mUSD, cUSD);

			await Treasury.setToken(
				mUSD.address,
				toEther(0.9),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath1,
				"0x"
			);
			await Treasury.setToken(
				cTKN.address,
				toEther(0.5),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath2,
				"0x"
			);

			await cTKN.mint(Treasury.address, toEther(100));

			// 48.992898509103758825
			await expect(
				Treasury.convertAmount(cTKN.address, toEther(100), 0, "0x")
			)
				.to.emit(Treasury, "AmountConverted")
				.withArgs(
					cTKN.address,
					toEther(100),
					0,
					exchangePath2,
					toEther("195.942794620063802459")
				);

			expect(await cTKN.balanceOf(Treasury.address)).to.be.equal(
				toEther(0)
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther("195.942794620063802459")
			);
		});

		it("Should convertAmount with custom path", async function () {
			const exchangePath1 = getExchangePath(mUSD, cUSD);
			const exchangePath2 = getExchangePath(cTKN, mUSD, cUSD);
			const exchangePath3 = getExchangePath(cTKN, cUSD);

			await Treasury.setToken(
				mUSD.address,
				toEther(0.9),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath1,
				"0x"
			);
			await Treasury.setToken(
				cTKN.address,
				toEther(0.5),
				LpStrategy.MainCoin,
				0,
				0,
				0,
				exchangePath2,
				"0x"
			);

			await createPool(
				owner,
				cUSD,
				cTKN,
				toEther(1000000),
				toEther(500000)
			);

			await cTKN.mint(Treasury.address, toEther(100));

			await expect(
				Treasury.convertAmount(
					cTKN.address,
					toEther(100),
					0,
					exchangePath3
				)
			)
				.to.emit(Treasury, "AmountConverted")
				.withArgs(
					cTKN.address,
					toEther(100),
					0,
					exchangePath3,
					toEther("197.960803760855350640")
				);

			expect(await cTKN.balanceOf(Treasury.address)).to.be.equal(
				toEther(0)
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(
				toEther("197.960803760855350640")
			);
		});
	});

	describe("Treasury + TreasuryLpSwap - basic", () => {
		before(async function () {});

		beforeEach(async () => {
			await deploy();
			await createPools();
		});

		it("Should not update UniswapRouter if not owner", async function () {
			await expect(
				TreasuryLpSwap.connect(user1).updateUniswapRouter(FAKE_ADDRESS)
			).to.be.rejectedWith(
				"TreasuryLpSwap: caller is not the owner nor ImpactMarketCouncil"
			);
			expect(await TreasuryLpSwap.uniswapRouter()).to.be.equal(
				uniswapRouterAddress
			);
		});

		it("Should update UniswapRouter if owner", async function () {
			await expect(TreasuryLpSwap.updateUniswapRouter(FAKE_ADDRESS)).to.be
				.fulfilled;
			expect(await TreasuryLpSwap.uniswapRouter()).to.be.equal(
				FAKE_ADDRESS
			);
		});

		it("Should not update UniswapQuoter if not owner", async function () {
			await expect(
				TreasuryLpSwap.connect(user1).updateUniswapQuoter(FAKE_ADDRESS)
			).to.be.rejectedWith(
				"TreasuryLpSwap: caller is not the owner nor ImpactMarketCouncil"
			);
			expect(await TreasuryLpSwap.uniswapQuoter()).to.be.equal(
				uniswapQuoterAddress
			);
		});

		it("Should update uniswapQuoter if owner", async function () {
			await expect(TreasuryLpSwap.updateUniswapQuoter(FAKE_ADDRESS)).to.be
				.fulfilled;
			expect(await TreasuryLpSwap.uniswapQuoter()).to.be.equal(
				FAKE_ADDRESS
			);
		});

		it("Should not update uniswapNFTPositionManager if not owner", async function () {
			await expect(
				TreasuryLpSwap.connect(user1).updateUniswapNFTPositionManager(
					FAKE_ADDRESS
				)
			).to.be.rejectedWith(
				"TreasuryLpSwap: caller is not the owner nor ImpactMarketCouncil"
			);
			expect(
				await TreasuryLpSwap.uniswapNFTPositionManager()
			).to.be.equal(uniswapNFTPositionManagerAddress);
		});

		it("Should update uniswapNFTPositionManager if owner", async function () {
			await expect(
				TreasuryLpSwap.updateUniswapNFTPositionManager(FAKE_ADDRESS)
			).to.be.fulfilled;
			expect(
				await TreasuryLpSwap.uniswapNFTPositionManager()
			).to.be.equal(FAKE_ADDRESS);
		});

		it("Should set token with uniswapTokenId if owner", async function () {
			const exchangePathToCUSD = getExchangePath(mUSD, cUSD);
			const exchangePathToPACT = getExchangePath(mUSD, PACT);

			await expect(
				Treasury.setToken(
					mUSD.address,
					toEther(1),
					LpStrategy.SecondaryCoin,
					0,
					0,
					mUSDToPACTTokenId,
					exchangePathToCUSD,
					exchangePathToPACT
				)
			)
				.to.emit(Treasury, "TokenSet")
				.withArgs(mUSD.address);

			const token = await Treasury.tokens(mUSD.address);
			expect(token.rate).to.be.equal(toEther(1));
			expect(token.lpStrategy).to.be.equal(LpStrategy.SecondaryCoin);
			expect(token.exchangePathToCUSD).to.be.equal(exchangePathToCUSD);
			expect(token.exchangePathToPACT).to.be.equal(exchangePathToPACT);
			expect(token.uniswapNFTPositionManagerId).to.be.equal(
				mUSDToPACTTokenId
			);
			expect(await Treasury.tokenListLength()).to.be.equal(2);
			expect(await Treasury.tokenListAt(0)).to.be.equal(cUSD.address);
			expect(await Treasury.tokenListAt(1)).to.be.equal(mUSD.address);
		});

		it("Should not set token with invalid uniswapTokenId", async function () {
			const exchangePathToCUSD = getExchangePath(mUSD, cUSD);
			const exchangePathToPACT = getExchangePath(mUSD, PACT);

			await expect(
				Treasury.setToken(
					mUSD.address,
					toEther(1),
					LpStrategy.SecondaryCoin,
					0,
					0,
					123,
					exchangePathToCUSD,
					exchangePathToPACT
				)
			).to.be.to.rejectedWith(
				"Treasury::setToken: invalid uniswapNFTPositionManagerId"
			);
		});

		// it("Should transferToTreasury without uniswapNFTPositionManagerId #1", async function () {
		// 	const initialTreasuryCUSDBalance = await cUSD.balanceOf(
		// 		Treasury.address
		// 	);
		//
		// 	await cUSD.approve(Treasury.address, toEther(1));
		//
		// 	await expect(Treasury.transferToTreasury(cUSD.address, toEther(1)))
		// 		.to.be.to.fulfilled;
		//
		// 	expect(await cUSD.balanceOf(Treasury.address)).to.be.equal(
		// 		initialTreasuryCUSDBalance.add(toEther(1))
		// 	);
		// });
		//
		// it("Should transferToTreasury without uniswapNFTPositionManagerId #2", async function () {
		// 	const initialTreasuryMUSDBalance = await mUSD.balanceOf(
		// 		Treasury.address
		// 	);
		//
		// 	await mUSD.approve(Treasury.address, toEther(1));
		//
		// 	await expect(Treasury.transferToTreasury(mUSD.address, toEther(1)))
		// 		.to.be.to.fulfilled;
		//
		// 	expect(await mUSD.balanceOf(Treasury.address)).to.be.equal(
		// 		initialTreasuryMUSDBalance.add(toEther(1))
		// 	);
		// });
	});

	describe("Treasury + TreasuryLpSwap - increase lp", () => {
		const initialUserBalance = toEther(1000000);

		before(async function () {});

		beforeEach(async () => {
			await deploy();
			await createPools();

			await Treasury.setToken(
				cUSD.address,
				toEther(1),
				LpStrategy.MainCoin,
				0,
				0,
				cUSDToPACTTokenId,
				"0x",
				getExchangePath(cUSD, PACT)
			);

			await Treasury.setToken(
				mUSD.address,
				toEther(1),
				LpStrategy.SecondaryCoin,
				0,
				0,
				mUSDToPACTTokenId,
				getExchangePath(mUSD, cUSD),
				getExchangePath(mUSD, PACT)
			);

			await cUSD.mint(user1.address, initialUserBalance);
			await mUSD.mint(user1.address, initialUserBalance);
		});

		// it("Should transferToTreasury with uniswapNFTPositionManagerId (cUSD, small amount)", async function () {
		// 	await cUSD.approve(Treasury.address, toEther(10));
		//
		// 	await expect(Treasury.transferToTreasury(cUSD.address, toEther(10)))
		// 		.to.emit(TreasuryLpSwap, "LiquidityIncreased")
		// 		.withArgs(
		// 			cUSDToPACTTokenId,
		// 			toEther("0.494999754975121287"),
		// 			toEther(0.5),
		// 			toEther("0.494999754975121287"),
		// 			toEther("0.495000245024999999")
		// 		);
		// });
		//
		// it("Should transferToTreasury with uniswapNFTPositionManagerId (mUSD, small amount)", async function () {
		// 	await mUSD.approve(Treasury.address, toEther(10));
		//
		// 	await expect(Treasury.transferToTreasury(mUSD.address, toEther(10)))
		// 		.to.emit(TreasuryLpSwap, "LiquidityIncreased")
		// 		.withArgs(
		// 			mUSDToPACTTokenId,
		// 			toEther("2.474987748810643387"),
		// 			toEther(5),
		// 			toEther("2.474987748810643387"),
		// 			toEther("4.950024502499999999")
		// 		);
		// });
		//
		// it("Should transferToTreasury with uniswapNFTPositionManagerId (cUSD, big amount)", async function () {
		// 	await cUSD.approve(Treasury.address, toEther(100000));
		//
		// 	await expect(
		// 		Treasury.transferToTreasury(cUSD.address, toEther(100000))
		// 	)
		// 		.to.emit(TreasuryLpSwap, "LiquidityIncreased")
		// 		.withArgs(
		// 			cUSDToPACTTokenId,
		// 			toEther("4925.618189959699487538"),
		// 			toEther(5000),
		// 			toEther("4925.618189959699487538"),
		// 			toEther("4974.502500000000000001")
		// 		);
		// });
		//
		// it("Should transferToTreasury with uniswapNFTPositionManagerId (mUSD, big amount)", async function () {
		// 	await mUSD.approve(Treasury.address, toEther(100000));
		//
		// 	await expect(
		// 		Treasury.transferToTreasury(mUSD.address, toEther(100000))
		// 	)
		// 		.to.emit(TreasuryLpSwap, "LiquidityIncreased")
		// 		.withArgs(
		// 			mUSDToPACTTokenId,
		// 			toEther("23582.658408766079085321"),
		// 			toEther(50000),
		// 			toEther("22697.348336885846636277"),
		// 			toEther("50000.000000000000000000")
		// 		);
		// });

		it("Should not decreaseLiquidity if not owner", async function () {
			await cUSD.approve(Treasury.address, toEther(1000));

			await expect(
				TreasuryLpSwap.connect(user1).decreaseLiquidity(
					cUSDToPACTTokenId,
					"11111"
				)
			).to.be.rejectedWith(
				"TreasuryLpSwap: caller is not the owner nor ImpactMarketCouncil"
			);
		});

		it("Should decreaseLiquidity if owner", async function () {
			const liquidity = (
				await NFTPositionManager.positions(cUSDToPACTTokenId)
			).liquidity;

			await expect(
				TreasuryLpSwap.connect(owner).decreaseLiquidity(
					cUSDToPACTTokenId,
					liquidity
				)
			)
				.to.emit(TreasuryLpSwap, "LiquidityDecreased")
				.withArgs(
					cUSDToPACTTokenId,
					liquidity,
					0,
					toEther("999999.999999999999999999"),
					toEther("999999.999999999999999999")
				);
		});

		it("Should decrease part of liquidity", async function () {
			const liquidity = (
				await NFTPositionManager.positions(cUSDToPACTTokenId)
			).liquidity;

			await expect(
				TreasuryLpSwap.connect(owner).decreaseLiquidity(
					cUSDToPACTTokenId,
					liquidity.div(3)
				)
			)
				.to.emit(TreasuryLpSwap, "LiquidityDecreased")
				.withArgs(
					cUSDToPACTTokenId,
					liquidity.div(3),
					liquidity.sub(liquidity.div(3)),
					toEther("333333.333333333333333333"),
					toEther("333333.333333333333333333")
				);
		});

		it("Should decreaseLiquidity if owner #2", async function () {
			const liquidity = (
				await NFTPositionManager.positions(cUSDToPACTTokenId)
			).liquidity;

			await expect(
				TreasuryLpSwap.connect(owner).decreaseLiquidity(
					cUSDToPACTTokenId,
					liquidity
				)
			)
				.to.emit(TreasuryLpSwap, "LiquidityDecreased")
				.withArgs(
					cUSDToPACTTokenId,
					liquidity,
					0,
					toEther("999999.999999999999999999"),
					toEther("999999.999999999999999999")
				);
		});

		it("Should decreaseLiquidity if owner #2", async function () {
			const liquidity = (
				await NFTPositionManager.positions(cUSDToPACTTokenId)
			).liquidity;

			await expect(
				TreasuryLpSwap.connect(owner).decreaseLiquidity(
					cUSDToPACTTokenId,
					liquidity
				)
			)
				.to.emit(TreasuryLpSwap, "LiquidityDecreased")
				.withArgs(
					cUSDToPACTTokenId,
					liquidity,
					0,
					toEther("999999.999999999999999999"),
					toEther("999999.999999999999999999")
				);
		});

		it("Should not collectFees if not owner", async function () {
			await expect(
				Treasury.connect(user1).collectFees(cUSDToPACTTokenId)
			).to.be.rejectedWith(
				"Treasury: caller is not the owner nor ImpactMarketCouncil"
			);
		});

		it("Should collectFees if owner", async function () {
			await swap(owner, cUSD, PACT, toEther(100));

			await expect(Treasury.connect(owner).collectFees(cUSDToPACTTokenId))
				.to.emit(TreasuryLpSwap, "FeesCollected")
				.withArgs(
					cUSDToPACTTokenId,
					0,
					toEther("0.999999999999999999")
				);

			expect(await PACT.balanceOf(FAKE_ADDRESS)).to.be.eq(0);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.eq(
				toEther("0.999999999999999999")
			);
			expect(await PACT.balanceOf(FAKE_ADDRESS)).to.be.eq(0);
		});

		it("Should collectFees cUSD", async function () {
			const treasuryInitialCUSDBalance = await cUSD.balanceOf(
				Treasury.address
			);
			const treasuryInitialPACTBalance = await PACT.balanceOf(
				Treasury.address
			);

			await swap(owner, PACT, cUSD, toEther(100));

			await expect(Treasury.connect(owner).collectFees(cUSDToPACTTokenId))
				.to.emit(TreasuryLpSwap, "FeesCollected")
				.withArgs(
					cUSDToPACTTokenId,
					toEther("0.999999999999999999"),
					0
				);

			expect(await PACT.balanceOf(Treasury.address)).to.be.eq(
				treasuryInitialPACTBalance.add(toEther("0"))
			);
			expect(await PACT.balanceOf(TreasuryLpSwap.address)).to.be.eq(
				treasuryInitialPACTBalance.add(toEther("0.999999999999999999"))
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.eq(
				treasuryInitialCUSDBalance.add(toEther(0))
			);

			expect(await cUSD.balanceOf(TreasuryLpSwap.address)).to.be.eq(0);
			expect(await PACT.balanceOf(FAKE_ADDRESS)).to.be.eq(0);
		});

		it("Should collectFees cUSD #2", async function () {
			const treasuryInitialCUSDBalance = await cUSD.balanceOf(
				Treasury.address
			);
			const treasuryInitialPACTBalance = await PACT.balanceOf(
				Treasury.address
			);

			await swap(owner, PACT, cUSD, toEther(50));
			await swap(owner, cUSD, PACT, toEther(100));

			await expect(Treasury.connect(owner).collectFees(cUSDToPACTTokenId))
				.to.emit(TreasuryLpSwap, "FeesCollected")
				.withArgs(
					cUSDToPACTTokenId,
					toEther("0.499999999999999999"),
					toEther("1")
				);

			expect(await PACT.balanceOf(Treasury.address)).to.be.eq(
				treasuryInitialPACTBalance.add(toEther("0"))
			);
			expect(await PACT.balanceOf(TreasuryLpSwap.address)).to.be.eq(
				treasuryInitialPACTBalance.add(toEther("0.499999999999999999"))
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.eq(
				treasuryInitialCUSDBalance.add(toEther("1"))
			);

			expect(await cUSD.balanceOf(TreasuryLpSwap.address)).to.be.eq(0);
			expect(await PACT.balanceOf(FAKE_ADDRESS)).to.be.eq(0);
		});

		it("Should collectFees other token", async function () {
			const treasuryInitialCUSDBalance = await cUSD.balanceOf(
				Treasury.address
			);
			const treasuryInitialPACTBalance = await PACT.balanceOf(
				Treasury.address
			);

			await swap(owner, PACT, mUSD, toEther(100));
			await swap(owner, mUSD, PACT, toEther(50));

			await expect(Treasury.connect(owner).collectFees(mUSDToPACTTokenId))
				.to.emit(TreasuryLpSwap, "FeesCollected")
				.withArgs(
					mUSDToPACTTokenId,
					toEther("0.999999999999999999"),
					toEther("0.499999999999999999")
				);

			expect(await PACT.balanceOf(Treasury.address)).to.be.eq(
				treasuryInitialPACTBalance.add(toEther("1.123786721591364695"))
			);
			expect(await cUSD.balanceOf(Treasury.address)).to.be.eq(
				treasuryInitialCUSDBalance.add(toEther("0.247499938743765159"))
			);

			expect(await PACT.balanceOf(TreasuryLpSwap.address)).to.be.eq(0);
			expect(await cUSD.balanceOf(TreasuryLpSwap.address)).to.be.eq(0);
			expect(await PACT.balanceOf(FAKE_ADDRESS)).to.be.eq(0);
		});
	});
});
