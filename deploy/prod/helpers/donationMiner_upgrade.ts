import { HardhatRuntimeEnvironment } from "hardhat/types";
import { DeployFunction } from "hardhat-deploy/types";
import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { deployments, ethers } from "hardhat";
import { createProposal, toEther } from "../../../test/utils/helpers";
import * as ethersTypes from "ethers";

const { deploy } = deployments;
let deployer: SignerWithAddress;

//alfajores
const governanceDelegatorAddress = "0x5c27e2600a3eDEF53DE0Ec32F01efCF145419eDF";
const proxyAdminAddress = "0x79f9ca5f1A01e1768b9C24AD37FF63A0199E3Fe5";
const donationMinerProxyAddress = "0x09Cdc8f50994F63103bc165B139631A6ad18EF49";


// // mainnet
// const governanceDelegatorAddress = "0x8f8BB984e652Cb8D0aa7C9D6712Ec2020EB1BAb4";
// const proxyAdminAddress = "0xFC641CE792c242EACcD545B7bee2028f187f61EC";
// const donationMinerProxyAddress = "0x1C51657af2ceBA3D5492bA0c5A17E562F7ba6593";

const contractName = 'DonationMinerImplementation';

let newImplementationAddress: string;

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
	// @ts-ignore
	// const { deployments, ethers } = hre;

	const accounts: SignerWithAddress[] = await ethers.getSigners();
	deployer = accounts[0];

	await deployNewImplementation();
	return;
	await createUpgradeImplementation();
};

async function deployNewImplementation() {
	console.log("Deploying new " + contractName);
	newImplementationAddress = (
		await deploy(contractName, {
			from: deployer.address,
			args: [],
			log: true,
			// gasLimit: 13000000,
		})
	).address;
}

async function createUpgradeImplementation() {
	console.log("Creating new proposal");

	await new Promise((resolve) => setTimeout(resolve, 6000));
	await createProposal(
		governanceDelegatorAddress,
		deployer,
		[
			proxyAdminAddress,
			donationMinerProxyAddress
		],
		[0, 0],
		[
			"upgrade(address,address)",
			"transfer(address,address,uint256)"   //this method is called only to check if the new implementation is correct
		],
		[["address", "address"], ["address", "address", "uint256"]],
		[
			[donationMinerProxyAddress, newImplementationAddress],
			["0x46c9757C5497c5B1f2eb73aE79b6B67D119B0B58","0xAfF6e8Bc719813DfAD6ce7c22e96Cd9783bFBE99", toEther(150000000)]
		],
		'Upgrade DonationMiner implementation and send reserve PACTs from DonationMiner to marketing'
	);
}

export default func;
func.tags = ["DonationMiner_upgrade"];
